import * as Crypto from 'expo-crypto';
import {Platform, ToastAndroid, Alert} from 'react-native';
import {RelayClient, REPAIRS_DISABLED_CODE} from '@aeris/shared';
import type {ConnectionMode, Product, ProductImageType} from '../types/api.types';
import {DirectClient} from './DirectClient';
import {uploadProductImage as uploadProductImageImpl} from './ProductImageClient';
import {useCloudReachabilityStore} from '../stores/cloudReachabilityStore';
import {useDrStore} from '../stores/drStore';
import {useWorkspaceFeaturesStore} from '../stores/workspaceFeaturesStore';

// Generic `deployment-*` code the gateway emits when a whole surface is off
// for the resolved workspace. Accept as a synonym for REPAIRS_DISABLED_CODE
// per the api.types comment at REPAIRS_DISABLED_CODE — a gateway that reuses
// the older namespace still triggers the same "repairs off" branch.
const DEPLOYMENT_UNSUPPORTED_SYNONYM = 'deployment-unsupported';

// Module-level guard so the "Repairs disabled for this site." toast fires
// AT MOST once per app session. The workspaceFeaturesStore setter would
// itself deduplicate the state flip, but the toast is a UI side-effect that
// needs its own single-shot latch.
let repairsDisabledToastShown = false;

// Cross-user hygiene: authStore.logout resets this so a user B logging into
// a different deployment on the same device still gets the toast if THEIR
// workspace flips repairs off later in the session. Without this, the
// process-lifetime latch would silence the second flip.
export function resetRepairsDisabledToastLatch(): void {
  repairsDisabledToastShown = false;
}

function showRepairsDisabledToast(): void {
  if (repairsDisabledToastShown) return;
  repairsDisabledToastShown = true;
  const msg = 'Repairs disabled for this site.';
  try {
    if (Platform.OS === 'android') {
      ToastAndroid.show(msg, ToastAndroid.LONG);
    } else {
      // iOS has no native toast; Alert.alert is the pattern used elsewhere in
      // the codebase for equivalent one-shot notices (see PrintService).
      Alert.alert('Repairs', msg);
    }
  } catch {
    // Toast is best-effort UX — never break the caller because notification
    // rendering failed.
  }
}

// Extracts the deployment-* error code from either a shared RelayError
// (`.code`) or a plain HTTP error whose body carries `{code}` / `{error:{code}}`
// (Direct-mode path). Returns null when the error isn't shaped like a
// deployment gate.
function extractDeploymentCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as {
    code?: unknown;
    message?: unknown;
  };
  if (typeof e.code === 'string') return e.code;
  // Direct mode surfaces the JSON body at the tail of the Error message:
  // "Request failed (403): {\"code\":\"deployment-repairs-disabled\",...}".
  if (typeof e.message === 'string') {
    const colonIdx = e.message.indexOf(': ');
    if (colonIdx >= 0) {
      const tail = e.message.slice(colonIdx + 2);
      try {
        const parsed = JSON.parse(tail) as {
          code?: string;
          error?: {code?: string};
        };
        if (parsed && typeof parsed.code === 'string') return parsed.code;
        if (parsed?.error && typeof parsed.error.code === 'string') {
          return parsed.error.code;
        }
      } catch {
        // Not JSON — no code to extract.
      }
    }
  }
  return null;
}

// Wraps a repairs.* dispatch: on a REPAIRS_DISABLED_CODE (or the generic
// `deployment-unsupported` synonym) it flips the workspaceFeaturesStore off
// and fires a one-shot toast, then re-throws so the caller can surface a
// screen-level "not available" state. Every other error propagates unchanged.
async function guardRepairsCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const code = extractDeploymentCode(err);
    if (
      code === REPAIRS_DISABLED_CODE ||
      code === DEPLOYMENT_UNSUPPORTED_SYNONYM
    ) {
      try {
        useWorkspaceFeaturesStore.getState().setRepairsEnabled(false);
      } catch {
        // Store not initialised yet in a test harness — swallow so the
        // caller still gets the original error.
      }
      showRepairsDisabledToast();
    }
    throw err;
  }
}

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

  // --- DR routing (M3-0) ---
  // Always over the relay (cloud) transport — DR routing state is delivered by
  // the deployment to its authenticated clients via the relay (option B), and
  // is meaningless on the Direct/LAN path (we'd be asking the NAS where to fail
  // over to). Returns null on a flag-off / non-DR deployment (graceful M2
  // fallback). Not routed through `.active` so it never sends the bearer to a
  // mismatch'd NAS.
  getDrRouting = (): ReturnType<RelayClient['getDrRouting']> =>
    this.relay.getDrRouting();

  // --- DR presence beat (M3) ---
  // Always over the relay (cloud) transport: the deployment proxies the beat to
  // the gateway's tenant-key-only /dr/presence beacon under its own tenant key.
  // Best-effort / fire-and-forget (the RelayClient swallows every non-2xx). Not
  // routed through `.active` so it never sends the bearer to a mismatch'd NAS.
  reportDrPresence = (
    ...args: Parameters<RelayClient['reportDrPresence']>
  ): ReturnType<RelayClient['reportDrPresence']> =>
    this.relay.reportDrPresence(...args);

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
  getSuppliers = () => this.active.getSuppliers();
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

  // --- Repairs ---
  // Every method is wrapped in `guardRepairsCall` so a gateway
  // REPAIRS_DISABLED_CODE (or the generic `deployment-unsupported` synonym)
  // yanks the workspace flag off + fires a one-shot toast. Actual routing is
  // through `.active` — same DR-cert-mismatch guard applies as everywhere else.
  listRepairs = (...args: Parameters<RelayClient['listRepairs']>) =>
    guardRepairsCall(() => this.active.listRepairs(...args));
  getRepairDetail = (...args: Parameters<RelayClient['getRepairDetail']>) =>
    guardRepairsCall(() => this.active.getRepairDetail(...args));
  getRepairStatusHistory = (
    ...args: Parameters<RelayClient['getRepairStatusHistory']>
  ) => guardRepairsCall(() => this.active.getRepairStatusHistory(...args));
  getPendingRepairsForCustomer = (
    ...args: Parameters<RelayClient['getPendingRepairsForCustomer']>
  ) =>
    guardRepairsCall(() => this.active.getPendingRepairsForCustomer(...args));
  createRepair = (...args: Parameters<RelayClient['createRepair']>) =>
    guardRepairsCall(() => this.active.createRepair(...args));
  updateRepair = (...args: Parameters<RelayClient['updateRepair']>) =>
    guardRepairsCall(() => this.active.updateRepair(...args));
  updateRepairStatus = (
    ...args: Parameters<RelayClient['updateRepairStatus']>
  ) => guardRepairsCall(() => this.active.updateRepairStatus(...args));
  addRepairItem = (...args: Parameters<RelayClient['addRepairItem']>) =>
    guardRepairsCall(() => this.active.addRepairItem(...args));
  updateRepairItem = (...args: Parameters<RelayClient['updateRepairItem']>) =>
    guardRepairsCall(() => this.active.updateRepairItem(...args));
  removeRepairItem = (...args: Parameters<RelayClient['removeRepairItem']>) =>
    guardRepairsCall(() => this.active.removeRepairItem(...args));
  bulkUpdateRepairStatus = (
    ...args: Parameters<RelayClient['bulkUpdateRepairStatus']>
  ) => guardRepairsCall(() => this.active.bulkUpdateRepairStatus(...args));
  deleteRepair = (...args: Parameters<RelayClient['deleteRepair']>) =>
    guardRepairsCall(() => this.active.deleteRepair(...args));
}

// RelayError remains importable from this module for back-compat with
// existing call sites (authStore, refreshSession.test); the canonical home
// is now @aeris/shared.
export {RelayError} from '@aeris/shared';

export default new ApiClient();
