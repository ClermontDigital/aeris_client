import * as Crypto from 'expo-crypto';
import {RelayClient} from '@aeris/shared';
import type {ConnectionMode, Product, ProductImageType} from '../types/api.types';
import {DirectClient} from './DirectClient';
import {uploadProductImage as uploadProductImageImpl} from './ProductImageClient';
import {useCloudReachabilityStore} from '../stores/cloudReachabilityStore';
import {useDrStore} from '../stores/drStore';

// Polyfill crypto.randomUUID for the shared RelayClient. Hermes does not
// reliably expose globalThis.crypto.randomUUID across all OS versions, so
// the previous implementation crashed with "crypto not found" on some
// devices. expo-crypto wraps the platform-native CSPRNG.
(() => {
  const g = globalThis as {crypto?: {randomUUID?: () => string}};
  if (!g.crypto || typeof g.crypto.randomUUID !== 'function') {
    g.crypto = {
      ...(g.crypto || {}),
      randomUUID: () => Crypto.randomUUID(),
    };
  }
})();

// Stateless facade over RelayClient (shared) + DirectClient (mobile-only).
// Workspace, token, and timeout live on the active client; the facade just
// dispatches based on the configured mode. Setters fan out to both clients
// so a mode switch preserves auth state — credential isolation between
// modes is the caller's job (see SettingsModal::clearLocalSession).
export class ApiClient {
  private relay = new RelayClient();
  private direct = new DirectClient();
  private mode: ConnectionMode = 'direct';

  constructor() {
    // Default relayUrl mirrors the previous monolithic ApiClient behaviour.
    this.relay.configure({relayUrl: 'https://api.aeris.team'});
    // M-R1 (§14.7 Q9 / §19.2 rule 4): drive the cloud-reachability signal off
    // EVERY relay transport response — product fetch, dashboard, all RPC — not
    // just the refresh-token path. Without this the cascade reads `null`
    // (treated as reachable) and the outage prompt never fires. Mirrors the
    // server-answered-vs-transport distinction: reachable=true ⇒ reportSuccess;
    // reachable=false ⇒ reportFailure(isTransport=true). Only the relay client
    // reports here — Direct/LAN traffic must not move the cloud signal.
    this.relay.setOnResponse((reachable: boolean) => {
      const store = useCloudReachabilityStore.getState();
      if (reachable) {
        store.reportSuccess();
      } else {
        store.reportFailure(true);
      }
    });
  }

  configure(options: {
    baseUrl?: string;
    relayUrl?: string;
    mode?: ConnectionMode;
    timeoutMs?: number;
    workspaceCode?: string;
  }): void {
    if (options.mode !== undefined) this.mode = options.mode;
    if (options.baseUrl !== undefined || options.timeoutMs !== undefined) {
      this.direct.configure({
        baseUrl: options.baseUrl,
        timeoutMs: options.timeoutMs,
      });
    }
    if (
      options.relayUrl !== undefined ||
      options.timeoutMs !== undefined ||
      options.workspaceCode !== undefined
    ) {
      this.relay.configure({
        relayUrl: options.relayUrl,
        timeoutMs: options.timeoutMs,
        workspaceCode: options.workspaceCode,
      });
    }
  }

  setAuthToken(token: string | null): void {
    this.direct.setAuthToken(token);
    this.relay.setAuthToken(token);
  }

  // The current bearer (kept in sync across both transports via setAuthToken).
  // Exposed for the DR presence beacon (§19.4), which scopes its push to the
  // caller's deployment with this token.
  getAuthToken(): string | null {
    return this.relay.getAuthToken();
  }

  setOnUnauthorized(cb: (() => void) | null): void {
    this.direct.setOnUnauthorized(cb);
    this.relay.setOnUnauthorized(cb);
  }

  // Refresh hook for the 401-retry path. Both transports get the same
  // callback; only the one that actually issued the failing call will
  // invoke it. The callback should refresh the token and call setAuthToken
  // before returning true.
  setOnRefresh(cb: (() => Promise<boolean>) | null): void {
    this.direct.setOnRefresh(cb);
    this.relay.setOnRefresh(cb);
  }

  getMode(): ConnectionMode {
    return this.mode;
  }

  getWorkspaceCode(): string {
    return this.relay.getWorkspaceCode();
  }

  // The marketplace/relay base URL. Always the relay client's URL regardless
  // of mode — the product-image upload path is marketplace-owned (R2) and the
  // dedicated /api/v1/products/image/* routes only live on the gateway.
  getRelayUrl(): string {
    return this.relay.getRelayUrl();
  }

  // True when the photo feature CAN be offered: there's a connected workspace
  // to mint an upload grant against. Direct-only (unpaired) setups have no
  // workspace code, so the affordance is hidden. The deployment may still turn
  // out to not support the actions — that surfaces as a typed `unsupported`
  // error from uploadProductImage which the picker uses to hide the button.
  canUploadProductImages(): boolean {
    return this.relay.getWorkspaceCode().length > 0;
  }

  // --- Products (image upload) ---
  // Dedicated HTTPS transport (NOT relayRpc): read bytes + sha256 -> mint
  // grant -> PUT bytes to R2 -> confirm -> returns the updated Product. Always
  // targets the relay base + workspace, even in 'direct' mode. The bearer is
  // read off the relay client (kept in sync with direct via setAuthToken).
  uploadProductImage = (
    productId: number,
    fileUri: string,
    type?: ProductImageType,
  ): Promise<Product> =>
    uploadProductImageImpl(
      {
        relayUrl: this.relay.getRelayUrl(),
        authToken: this.relay.getAuthToken(),
        workspaceCode: this.relay.getWorkspaceCode(),
      },
      productId,
      fileUri,
      type,
    );

  private get active(): RelayClient | DirectClient {
    if (this.mode !== 'relay') {
      // M-R3 (credential-leak closure, lifted into M1): refuse to dispatch a
      // Direct/LAN call to a NAS whose TLS identity has FAILED the pin
      // ('mismatch'). The §19.2 cascade already fails-closed, but any path that
      // bypasses it (manual settings switch, deep-link, test harness) would
      // otherwise still send the bearer token to a spoofed host. This is NOT
      // full SPKI pinning (that's M2) — it's the leak closure: throw before the
      // token can leave the device. 'unverified'/'unknown' stay permitted (the
      // UI surfaces the unverified state) until pinning ships.
      if (useDrStore.getState().certTrust === 'mismatch') {
        throw new Error(
          'On-prem (Direct) connection blocked — the server identity could ' +
            'not be verified. Sign in again from Settings.',
        );
      }
      return this.direct;
    }
    return this.relay;
  }

  // --- Auth ---
  login = (...args: Parameters<RelayClient['login']>) => this.active.login(...args);
  loginBiometric = (...args: Parameters<RelayClient['loginBiometric']>) =>
    this.active.loginBiometric(...args);
  logout = () => this.active.logout();
  refreshToken = () => this.active.refreshToken();

  // --- Dashboard ---
  getDailySummary = (...args: Parameters<RelayClient['getDailySummary']>) =>
    this.active.getDailySummary(...args);
  getRollingTopProducts = (
    ...args: Parameters<RelayClient['getRollingTopProducts']>
  ) => this.active.getRollingTopProducts(...args);

  // --- Products ---
  searchProducts = (...args: Parameters<RelayClient['searchProducts']>) =>
    this.active.searchProducts(...args);
  listProducts = (...args: Parameters<RelayClient['listProducts']>) =>
    this.active.listProducts(...args);
  getProductByBarcode = (...args: Parameters<RelayClient['getProductByBarcode']>) =>
    this.active.getProductByBarcode(...args);
  getProductDetail = (...args: Parameters<RelayClient['getProductDetail']>) =>
    this.active.getProductDetail(...args);
  getCategories = () => this.active.getCategories();
  getPaymentMethods = () => this.active.getPaymentMethods();

  // --- Inventory ---
  getStock = (...args: Parameters<RelayClient['getStock']>) =>
    this.active.getStock(...args);
  adjustStock = (...args: Parameters<RelayClient['adjustStock']>) =>
    this.active.adjustStock(...args);

  // --- Sales ---
  createSale = (...args: Parameters<RelayClient['createSale']>) =>
    this.active.createSale(...args);
  getTransactions = (...args: Parameters<RelayClient['getTransactions']>) =>
    this.active.getTransactions(...args);
  getTransactionDetail = (...args: Parameters<RelayClient['getTransactionDetail']>) =>
    this.active.getTransactionDetail(...args);
  getReceipt = (...args: Parameters<RelayClient['getReceipt']>) =>
    this.active.getReceipt(...args);
  getInvoicePdfUrl = (...args: Parameters<RelayClient['getInvoicePdfUrl']>) =>
    this.active.getInvoicePdfUrl(...args);
  refundSale = (...args: Parameters<RelayClient['refundSale']>) =>
    this.active.refundSale(...args);

  // --- Customers ---
  searchCustomers = (...args: Parameters<RelayClient['searchCustomers']>) =>
    this.active.searchCustomers(...args);
  listCustomers = (...args: Parameters<RelayClient['listCustomers']>) =>
    this.active.listCustomers(...args);
  getCustomerDetail = (...args: Parameters<RelayClient['getCustomerDetail']>) =>
    this.active.getCustomerDetail(...args);

  // --- Customers (writes) ---
  createCustomer = (...args: Parameters<RelayClient['createCustomer']>) =>
    this.active.createCustomer(...args);
  updateCustomer = (...args: Parameters<RelayClient['updateCustomer']>) =>
    this.active.updateCustomer(...args);
  deleteCustomer = (...args: Parameters<RelayClient['deleteCustomer']>) =>
    this.active.deleteCustomer(...args);

  // --- Products (writes) ---
  createProduct = (...args: Parameters<RelayClient['createProduct']>) =>
    this.active.createProduct(...args);
  updateProduct = (...args: Parameters<RelayClient['updateProduct']>) =>
    this.active.updateProduct(...args);
}

// RelayError remains importable from this module for back-compat with
// existing call sites (authStore, refreshSession.test); the canonical home
// is now @aeris/shared.
export {RelayError} from '@aeris/shared';

export default new ApiClient();
