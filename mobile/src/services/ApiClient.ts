import * as Crypto from 'expo-crypto';
import {API_ENDPOINTS, RELAY_ACTIONS} from '../constants/api';
import {validateWorkspaceCode} from '../constants/config';
import type {
  AuthResponse,
  BiometricCredential,
  ConnectionMode,
  Product,
  ProductDetail,
  Sale,
  SaleDetail,
  DailySummary,
  PaymentMethod,
  ReceiptData,
  Customer,
  Category,
  PaginatedResponse,
  RelayEnvelope,
  StockSnapshot,
} from '../types/api.types';
import {
  emptyPage,
  normalizeCustomer,
  normalizeProduct,
  normalizeProductDetail,
  normalizeReceipt,
  normalizeSale,
  normalizeSaleDetail,
  unwrapResource,
  unwrapList,
} from './normalizers';
import {
  RelayError,
  SALE_RETRY,
  backoffDelay,
  isNotFound,
  isRetryable,
  sleep,
  withReadRetry,
} from './retry';

export {RelayError} from './retry';
export {
  normalizeAddress,
  normalizeCustomer,
  normalizeProduct,
  normalizeProductDetail,
  normalizeProductVariant,
  normalizeReceipt,
  normalizeSale,
  normalizeSaleDetail,
} from './normalizers';

const DEFAULT_TIMEOUT_MS = 20_000;
const RELAY_BUFFER_MS = 3_000; // client waits this long beyond server-side timeout

interface RequestOptions {
  idempotencyKey?: string;
}

// Use expo-crypto rather than the Hermes `crypto` global — Hermes does not
// reliably expose `crypto.getRandomValues` across all OS versions, so the
// previous implementation crashed with "crypto not found" on some devices.
function generateUuid(): string {
  return Crypto.randomUUID();
}

export class ApiClient {
  private baseUrl: string = '';
  private relayUrl: string = 'https://api.aeris.team';
  private authToken: string | null = null;
  private mode: ConnectionMode = 'direct';
  private timeoutMs: number = DEFAULT_TIMEOUT_MS;
  private onUnauthorizedCb: (() => void) | null = null;
  private workspaceCode: string = '';

  configure(options: {
    baseUrl?: string;
    relayUrl?: string;
    mode?: ConnectionMode;
    timeoutMs?: number;
    workspaceCode?: string;
  }): void {
    // Note on mode-change credential isolation:
    // configure() does NOT auto-wipe authToken on mode change. App.tsx fires
    // configure() reactively when settings hydrate at cold-boot, which races
    // with restoreSession() — auto-wiping would log the user out every cold
    // start in relay mode. Credential isolation (preventing a direct-mode
    // ERP token leaking to the relay edge or vice-versa) is the caller's
    // job at the actual user-initiated change point: SettingsModal calls
    // clearLocalSession before saving a new connectionMode.
    if (options.baseUrl !== undefined) this.baseUrl = options.baseUrl;
    if (options.relayUrl !== undefined) this.relayUrl = options.relayUrl;
    if (options.mode !== undefined) this.mode = options.mode;
    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      this.timeoutMs = options.timeoutMs;
    }
    if (options.workspaceCode !== undefined) {
      if (options.workspaceCode === '') {
        this.workspaceCode = '';
      } else if (validateWorkspaceCode(options.workspaceCode) !== null) {
        console.warn('Invalid workspace code passed to ApiClient.configure(); ignoring.');
        this.workspaceCode = '';
      } else {
        this.workspaceCode = options.workspaceCode;
      }
    }
  }

  setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  setOnUnauthorized(cb: (() => void) | null): void {
    this.onUnauthorizedCb = cb;
  }

  getMode(): ConnectionMode {
    return this.mode;
  }

  getWorkspaceCode(): string {
    return this.workspaceCode;
  }

  // --- Auth ---
  async login(
    email: string,
    password: string,
    deviceName?: string,
  ): Promise<AuthResponse> {
    // auth.login is unauth-only on the gateway. Make sure no stale bearer
    // is sent — even if the in-memory token is set from a prior session,
    // the gateway would either treat us as user-traffic (wrong audience)
    // or 401. Clearing it pre-call is the correct unauth-mode guarantee.
    this.authToken = null;
    if (this.mode === 'relay') {
      return this.relayRpc<AuthResponse>(RELAY_ACTIONS.AUTH_LOGIN, {
        email,
        password,
        device_name: deviceName,
      });
    }
    return this.post<AuthResponse>(API_ENDPOINTS.AUTH_LOGIN, {
      email,
      password,
      device_name: deviceName,
    });
  }

  // NOTE: auth.biometric is NOT on the marketplace gateway's unauth allow-list
  // (only auth.login is). It must run in user-traffic mode — i.e. the caller
  // must already hold a valid session token. We deliberately DO NOT clear
  // authToken here: that would guarantee a 401. UI does not surface biometric
  // login in the current build; this method is wired but inert until the
  // marketplace allow-lists auth.biometric.
  async loginBiometric(credential: BiometricCredential): Promise<AuthResponse> {
    if (this.mode === 'relay') {
      return this.relayRpc<AuthResponse>(
        RELAY_ACTIONS.AUTH_BIOMETRIC,
        credential as unknown as Record<string, unknown>,
      );
    }
    // Direct mode: backend exposes biometric login at the same auth root
    return this.post<AuthResponse>(
      `${API_ENDPOINTS.AUTH_LOGIN}/biometric`,
      credential,
    );
  }

  async logout(): Promise<void> {
    // No-op when there's nothing to revoke — avoids firing
    // `Authorization: Bearer null` and a guaranteed 401 against the server.
    if (!this.authToken) return;
    try {
      if (this.mode === 'relay') {
        await this.relayRpc(RELAY_ACTIONS.AUTH_LOGOUT, {});
      } else {
        await this.post(API_ENDPOINTS.AUTH_LOGOUT, {});
      }
    } finally {
      this.authToken = null;
    }
  }

  // Mints a fresh Sanctum token off the current bearer. Caller is responsible
  // for persisting the new token + expires_at and calling setAuthToken().
  // Failures (401, network) propagate so the caller can decide whether to
  // wipe the session (proactive expired path) or simply log and retry later.
  async refreshToken(): Promise<AuthResponse> {
    if (this.mode === 'relay') {
      return this.relayRpc<AuthResponse>(RELAY_ACTIONS.AUTH_REFRESH, {});
    }
    return this.post<AuthResponse>('/api/v1/auth/refresh', {});
  }

  // --- Dashboard ---
  async getDailySummary(
    date?: string,
    locationId?: number,
  ): Promise<DailySummary> {
    return withReadRetry(() => {
      if (this.mode === 'relay') {
        return this.relayRpc<DailySummary>(RELAY_ACTIONS.DASHBOARD_SUMMARY, {
          date,
          location_id: locationId,
        });
      }
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (locationId) params.set('location_id', String(locationId));
      const qs = params.toString();
      return this.get<DailySummary>(
        `${API_ENDPOINTS.POS_DAILY_SUMMARY}${qs ? `?${qs}` : ''}`,
      );
    });
  }

  // --- Products ---
  async searchProducts(
    query: string,
    page = 1,
    perPage = 20,
    categoryId?: number,
  ): Promise<PaginatedResponse<Product>> {
    const trimmed = query.trim();
    if (!trimmed) {
      return emptyPage<Product>(page, perPage);
    }

    return withReadRetry(async () => {
      let raw: PaginatedResponse<unknown>;
      if (this.mode === 'relay') {
        raw = await this.relayRpc<PaginatedResponse<unknown>>(
          RELAY_ACTIONS.PRODUCTS_SEARCH,
          {query: trimmed, page, per_page: perPage, category_id: categoryId},
        );
      } else {
        const params = new URLSearchParams({
          q: trimmed,
          page: String(page),
          per_page: String(perPage),
        });
        if (categoryId) params.set('category_id', String(categoryId));
        raw = await this.get<PaginatedResponse<unknown>>(
          `${API_ENDPOINTS.PRODUCTS_SEARCH}?${params}`,
        );
      }
      return {
        ...raw,
        data: (raw.data || []).map(normalizeProduct),
      };
    });
  }

  async listProducts(
    page = 1,
    perPage = 50,
    categoryId?: number,
  ): Promise<PaginatedResponse<Product>> {
    return withReadRetry(async () => {
      let raw: PaginatedResponse<unknown>;
      if (this.mode === 'relay') {
        raw = await this.relayRpc<PaginatedResponse<unknown>>(
          RELAY_ACTIONS.PRODUCTS_LIST,
          {page, per_page: perPage, category_id: categoryId},
        );
      } else {
        const params = new URLSearchParams({
          page: String(page),
          per_page: String(perPage),
        });
        if (categoryId) params.set('category_id', String(categoryId));
        raw = await this.get<PaginatedResponse<unknown>>(
          `${API_ENDPOINTS.POS_PRODUCTS}?${params}`,
        );
      }
      return {
        ...raw,
        data: (raw.data || []).map(normalizeProduct),
      };
    });
  }

  async getProductByBarcode(barcode: string): Promise<ProductDetail | null> {
    return withReadRetry(async () => {
      try {
        let raw: unknown;
        if (this.mode === 'relay') {
          // `code` alias is the placeholder name in the dispatcher route
          // `/api/v1/products/barcode/{code}`; sending both keys is what
          // the proposed dispatcher fix expects so this auto-lights-up.
          raw = await this.relayRpc<unknown>(
            RELAY_ACTIONS.PRODUCTS_BARCODE,
            {barcode, code: barcode},
          );
        } else {
          raw = await this.get<unknown>(
            `${API_ENDPOINTS.PRODUCTS_BARCODE}/${encodeURIComponent(barcode)}`,
          );
        }
        return raw == null ? null : normalizeProductDetail(unwrapResource(raw));
      } catch (e) {
        if (isNotFound(e, this.mode)) return null;
        throw e;
      }
    });
  }

  async getProductDetail(productId: number): Promise<ProductDetail | null> {
    return withReadRetry(async () => {
      try {
        let raw: unknown;
        if (this.mode === 'relay') {
          raw = await this.relayRpc<unknown>(
            RELAY_ACTIONS.PRODUCTS_DETAIL,
            {product_id: productId, id: productId},
          );
        } else {
          raw = await this.get<unknown>(
            `${API_ENDPOINTS.POS_PRODUCTS}/${productId}`,
          );
        }
        return raw == null ? null : normalizeProductDetail(unwrapResource(raw));
      } catch (e) {
        if (isNotFound(e, this.mode)) return null;
        throw e;
      }
    });
  }

  async getCategories(): Promise<Category[]> {
    return withReadRetry(async () => {
      const result =
        this.mode === 'relay'
          ? await this.relayRpc<unknown>(RELAY_ACTIONS.PRODUCTS_CATEGORIES, {})
          : await this.get<unknown>(API_ENDPOINTS.PRODUCTS_CATEGORIES);
      return unwrapList<Category>(result);
    });
  }

  async getPaymentMethods(): Promise<PaymentMethod[]> {
    return withReadRetry(async () => {
      const result =
        this.mode === 'relay'
          ? await this.relayRpc<unknown>(RELAY_ACTIONS.POS_PAYMENT_METHODS, {})
          : await this.get<unknown>(API_ENDPOINTS.POS_PAYMENT_METHODS);
      return unwrapList<PaymentMethod>(result);
    });
  }

  // --- Inventory ---
  async getStock(
    productId: number,
    locationId?: number,
  ): Promise<StockSnapshot> {
    return withReadRetry(() => {
      if (this.mode === 'relay') {
        return this.relayRpc<StockSnapshot>(RELAY_ACTIONS.INVENTORY_STOCK, {
          product_id: productId,
          location_id: locationId,
        });
      }
      const params = new URLSearchParams({product_id: String(productId)});
      if (locationId) params.set('location_id', String(locationId));
      return this.get<StockSnapshot>(
        `${API_ENDPOINTS.POS_PRODUCTS}/${productId}/stock?${params}`,
      );
    });
  }

  // --- Sales ---
  async createSale(data: {
    items: Array<{
      product_id: number;
      quantity: number;
      unit_price_cents: number;
      discount_cents?: number;
    }>;
    payments: Array<{
      method: string;
      amount_cents: number;
      reference?: string;
    }>;
    customer_id?: number;
    discount_cents?: number;
    notes?: string;
  }): Promise<{sale_id: number; sale_number: string; total_cents: number}> {
    // Public signature stays in cents; convert to the dollar-shape that
    // Aeris2's POSController::processSale (mapped from sale.create) expects.
    // ProcessSaleRequest validates required dollar fields (unit_price,
    // amount, subtotal, total_amount) and runs a cross-field math check
    // that demands subtotal == sum(qty * unit_price_ex_gst - discount_ex_gst)
    // ±0.02. Items are flagged gst_applicable: true so the server splits
    // inc-GST → ex-GST itself (AU 10%).
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const centsToDollars = (c: number) => round2(c / 100);

    const lineTotalCents = data.items.reduce(
      (sum, i) => sum + i.unit_price_cents * i.quantity - (i.discount_cents ?? 0),
      0,
    );
    const paymentsTotalCents = data.payments.reduce(
      (sum, p) => sum + p.amount_cents,
      0,
    );
    // The server validates two cross-field invariants:
    //   1. `subtotal == sum(qty * unit_price_ex_gst - discount_ex_gst) ±0.02`
    //      — line-only, no cart-level discount in this sum. So `subtotal` and
    //      `tax_amount` are derived from the PRE-cart-discount line totals.
    //   2. `total_amount == sum(payments[].amount)` — the "total payment
    //      amount must equal total amount" rule. We derive `total_amount`
    //      directly from the payments sum so that invariant holds by
    //      construction regardless of how the caller balances cart-level
    //      discount vs payment amount.
    // The cart-level discount carries on the separate top-level
    // `discount_amount` field; the server reconciles
    // `subtotal + tax_amount - discount_amount == total_amount`.
    const cartDiscountCents = Math.max(0, data.discount_cents ?? 0);
    const lineTotalDollars = centsToDollars(lineTotalCents);
    const subtotal = round2(lineTotalDollars / 1.10);
    const taxAmount = round2(lineTotalDollars - subtotal);
    const totalAmount = centsToDollars(paymentsTotalCents);

    const payload: Record<string, unknown> = {
      items: data.items.map(i => ({
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price: centsToDollars(i.unit_price_cents),
        gst_applicable: true,
        discount_amount: i.discount_cents ? centsToDollars(i.discount_cents) : 0,
      })),
      payments: data.payments.map(p => ({
        method: p.method,
        amount: centsToDollars(p.amount_cents),
        ...(p.reference ? {reference: p.reference} : {}),
      })),
      subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
    };
    if (data.customer_id !== undefined) payload.customer_id = data.customer_id;
    if (cartDiscountCents > 0) payload.discount_amount = centsToDollars(cartDiscountCents);
    if (data.notes) payload.notes = data.notes;

    // One key per logical sale, reused on every retry. Gateway dedupes at
    // /api/relay/rpc (and propagates X-Aeris-Idempotency-Key on to the
    // deployment), so retrying with the same key is end-to-end safe.
    const idempotencyKey = generateUuid();
    let lastError: unknown;
    for (let attempt = 1; attempt <= SALE_RETRY.maxAttempts; attempt++) {
      try {
        let result: unknown;
        if (this.mode === 'relay') {
          result = await this.relayRpc(RELAY_ACTIONS.SALE_CREATE, payload, {
            idempotencyKey,
          });
        } else {
          result = await this.post(API_ENDPOINTS.POS_SALES, payload, {
            idempotencyKey,
          });
        }
        // POSController::processSale returns SaleResource; the resource
        // emits `id` (not sale_id). Map at the boundary so the public
        // return shape is unchanged. Tolerate either field for resilience
        // against future shape drift.
        const unwrapped = unwrapResource<{
          id?: number;
          sale_id?: number;
          sale_number?: string;
          total_cents?: number;
          total_amount?: number;
        }>(result);
        return {
          sale_id: (unwrapped.id ?? unwrapped.sale_id) as number,
          sale_number: unwrapped.sale_number ?? '',
          total_cents:
            typeof unwrapped.total_cents === 'number'
              ? unwrapped.total_cents
              : typeof unwrapped.total_amount === 'number'
              ? Math.round(unwrapped.total_amount * 100)
              : 0,
        };
      } catch (e) {
        lastError = e;
        if (
          attempt >= SALE_RETRY.maxAttempts ||
          !isRetryable(e)
        ) {
          throw e;
        }
        const delay = backoffDelay(attempt, SALE_RETRY.baseDelayMs);
        console.log(
          `[sale] retry ${attempt}/${SALE_RETRY.maxAttempts - 1} ` +
            `after ${delay}ms idem=${idempotencyKey}`,
        );
        await sleep(delay);
      }
    }
    throw lastError;
  }

  async getTransactions(params?: {
    page?: number;
    per_page?: number;
    date_from?: string;
    date_to?: string;
  }): Promise<PaginatedResponse<Sale>> {
    return withReadRetry(async () => {
      let raw: PaginatedResponse<unknown>;
      if (this.mode === 'relay') {
        raw = await this.relayRpc<PaginatedResponse<unknown>>(
          RELAY_ACTIONS.TRANSACTIONS_LIST,
          params || {},
        );
      } else {
        const urlParams = new URLSearchParams();
        if (params?.page) urlParams.set('page', String(params.page));
        if (params?.per_page) urlParams.set('per_page', String(params.per_page));
        if (params?.date_from) urlParams.set('date_from', params.date_from);
        if (params?.date_to) urlParams.set('date_to', params.date_to);
        const qs = urlParams.toString();
        raw = await this.get<PaginatedResponse<unknown>>(
          `${API_ENDPOINTS.SALES_LIST}${qs ? `?${qs}` : ''}`,
        );
      }
      return {
        ...raw,
        data: (raw.data || []).map(normalizeSale),
      };
    });
  }

  async getTransactionDetail(saleId: number): Promise<SaleDetail | null> {
    return withReadRetry(async () => {
      try {
        let raw: unknown;
        if (this.mode === 'relay') {
          raw = await this.relayRpc<unknown>(
            RELAY_ACTIONS.TRANSACTIONS_DETAIL,
            {sale_id: saleId, id: saleId},
          );
        } else {
          raw = await this.get<unknown>(
            `${API_ENDPOINTS.SALES_LIST}/${saleId}`,
          );
        }
        return normalizeSaleDetail(unwrapResource(raw));
      } catch (e) {
        if (isNotFound(e, this.mode)) return null;
        throw e;
      }
    });
  }

  async getReceipt(saleId: number): Promise<ReceiptData> {
    return withReadRetry(async () => {
      let raw: unknown;
      if (this.mode === 'relay') {
        // `id` alias mirrors the dispatcher placeholder for /api/v1/sales/{id}/receipt;
        // see reference_marketplace_dispatcher_bug.md.
        raw = await this.relayRpc<unknown>(RELAY_ACTIONS.TRANSACTIONS_RECEIPT, {
          sale_id: saleId,
          id: saleId,
        });
      } else {
        raw = await this.get<unknown>(
          `${API_ENDPOINTS.SALES_LIST}/${saleId}/receipt`,
        );
      }
      return normalizeReceipt(unwrapResource(raw));
    });
  }

  // --- Customers ---
  async searchCustomers(
    query: string,
    page = 1,
  ): Promise<PaginatedResponse<Customer>> {
    const trimmed = query.trim();
    if (!trimmed) {
      return emptyPage<Customer>(page, 20);
    }
    return withReadRetry(async () => {
      let raw: PaginatedResponse<unknown>;
      if (this.mode === 'relay') {
        raw = await this.relayRpc<PaginatedResponse<unknown>>(
          RELAY_ACTIONS.CUSTOMERS_SEARCH,
          {query: trimmed, term: trimmed, page},
        );
      } else {
        raw = await this.get<PaginatedResponse<unknown>>(
          `${API_ENDPOINTS.CUSTOMERS_SEARCH}?q=${encodeURIComponent(trimmed)}&page=${page}`,
        );
      }
      return {
        ...raw,
        data: (raw.data || []).map(normalizeCustomer),
      };
    });
  }

  async listCustomers(
    page = 1,
    perPage = 50,
  ): Promise<PaginatedResponse<Customer>> {
    return withReadRetry(async () => {
      let raw: PaginatedResponse<unknown>;
      if (this.mode === 'relay') {
        raw = await this.relayRpc<PaginatedResponse<unknown>>(
          RELAY_ACTIONS.CUSTOMERS_LIST,
          {page, per_page: perPage},
        );
      } else {
        const params = new URLSearchParams({
          page: String(page),
          per_page: String(perPage),
        });
        raw = await this.get<PaginatedResponse<unknown>>(
          `${API_ENDPOINTS.CUSTOMERS_LIST}?${params}`,
        );
      }
      return {
        ...raw,
        data: (raw.data || []).map(normalizeCustomer),
      };
    });
  }

  async getCustomerDetail(customerId: number): Promise<Customer | null> {
    return withReadRetry(async () => {
      try {
        let raw: unknown;
        if (this.mode === 'relay') {
          raw = await this.relayRpc<unknown>(
            RELAY_ACTIONS.CUSTOMERS_DETAIL,
            {customer_id: customerId, id: customerId},
          );
        } else {
          raw = await this.get<unknown>(
            `${API_ENDPOINTS.CUSTOMERS_LIST}/${customerId}`,
          );
        }
        return raw == null ? null : normalizeCustomer(unwrapResource(raw));
      } catch (e) {
        if (isNotFound(e, this.mode)) return null;
        throw e;
      }
    });
  }

  // --- Internal HTTP methods ---
  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private post<T>(
    path: string,
    body: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }
    if (options?.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (response.status === 401) {
        this.handleUnauthorized();
        const err = new Error('Authentication expired. Please log in again.');
        (err as Error & {status?: number}).status = 401;
        throw err;
      }

      if (!response.ok) {
        const errorBody = await response.text();
        const err = new Error(
          `Request failed (${response.status}): ${errorBody}`,
        );
        (err as Error & {status?: number}).status = response.status;
        throw err;
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  // --- Relay RPC ---
  // Server-side timeout is sent in seconds. Client fetch waits a small buffer
  // longer so we aren't aborting before the relay has a chance to respond.
  private async relayRpc<T>(
    action: string,
    params: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const url = `${this.relayUrl}/api/relay/rpc`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }
    if (this.workspaceCode) {
      headers['X-Aeris-Workspace'] = this.workspaceCode;
    }
    if (options?.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    const serverTimeoutSec = Math.max(
      5,
      Math.min(30, Math.floor(this.timeoutMs / 1000)),
    );
    const clientTimeoutMs = serverTimeoutSec * 1000 + RELAY_BUFFER_MS;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), clientTimeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({action, params, timeout: serverTimeoutSec}),
        signal: controller.signal,
      });

      if (response.status === 401) {
        this.handleUnauthorized();
        const err = new Error('Authentication expired. Please log in again.');
        (err as Error & {status?: number}).status = 401;
        throw err;
      }

      // Per the marketplace contract, only HTTP 200 / 502 / 504 carry the
      // RelayRPCResponse envelope. Other statuses (400 validation, 404 no
      // service config, 5xx gateway) return a JSON body that does NOT have
      // {correlation_id, status} — treat those as plain HTTP errors so we
      // don't accidentally unwrap an undefined `data` field.
      let envelope: RelayEnvelope<T> | null = null;
      try {
        const parsed = (await response.json()) as Partial<RelayEnvelope<T>>;
        if (
          parsed &&
          typeof parsed.correlation_id === 'string' &&
          (parsed.status === 'success' ||
            parsed.status === 'ok' ||
            parsed.status === 'error' ||
            parsed.status === 'timeout')
        ) {
          envelope = parsed as RelayEnvelope<T>;
        }
      } catch {
        // Body wasn't JSON — fall through to HTTP error handling below.
      }

      if (!envelope) {
        // 502/503/504 with no envelope means the relay edge itself is
        // unhealthy (gateway down, upstream timeout). The tech-flavoured
        // "Relay request failed (502)" leaks implementation detail; show
        // a friendlier copy for these specific transport states. Status
        // remains attached so isRetryable still classifies correctly.
        const isTransportFailure =
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504;
        const err = new Error(
          isTransportFailure
            ? "Couldn't reach the server. Please try again."
            : `Relay request failed (${response.status})`,
        );
        (err as Error & {status?: number}).status = response.status;
        throw err;
      }

      // Log every relay call so support can trace by correlation_id.
      console.log(
        `[relay] ${action} ${envelope.status} cid=${envelope.correlation_id}` +
          (envelope.duration_ms != null ? ` ${envelope.duration_ms}ms` : ''),
      );

      if (envelope.status === 'timeout') {
        throw new RelayError(
          'Server did not respond in time. Please try again.',
          'TIMEOUT',
          envelope.correlation_id,
          action,
        );
      }
      if (envelope.status === 'error') {
        throw new RelayError(
          envelope.error?.message || 'Relay request failed',
          envelope.error?.code || 'UNKNOWN',
          envelope.correlation_id,
          action,
        );
      }
      // 'success' (canonical) or 'ok' (defensive — see SITREP)
      return envelope.data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private handleUnauthorized(): void {
    this.authToken = null;
    if (this.onUnauthorizedCb) {
      try {
        this.onUnauthorizedCb();
      } catch (cbErr) {
        console.warn('onUnauthorized callback threw:', cbErr);
      }
    }
  }
}

export default new ApiClient();
