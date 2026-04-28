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

const DEFAULT_TIMEOUT_MS = 20_000;
const RELAY_BUFFER_MS = 3_000; // client waits this long beyond server-side timeout

// Default retry policy for idempotent POSTs. Three attempts is enough to ride
// out a brief network blip or relay restart without keeping the cashier
// waiting longer than ~6s in the worst case (with jitter).
const SALE_RETRY = {maxAttempts: 3, baseDelayMs: 500} as const;

export class RelayError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly correlationId: string | null,
    public readonly action: string,
  ) {
    super(message);
    this.name = 'RelayError';
  }
}

interface RequestOptions {
  idempotencyKey?: string;
}

function generateUuid(): string {
  const bytes = new Uint8Array(16);
  // Available in Hermes; polyfilled in jest.setup.ts for tests.
  crypto.getRandomValues(bytes);
  // RFC 4122 v4 fields
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function isRetryable(err: unknown): boolean {
  if (err instanceof RelayError) {
    // Only "timeout" envelopes are safely retryable. Application errors
    // (INSUFFICIENT_STOCK, VALIDATION, etc.) are deterministic — retrying
    // would just produce the same failure with extra latency.
    return err.code === 'TIMEOUT';
  }
  if (err instanceof Error) {
    const status = (err as Error & {status?: number}).status;
    if (status === 408 || status === 429 || status === 504) return true;
    if (status !== undefined && status >= 500 && status < 600) return true;
    if (status !== undefined && status >= 400 && status < 500) return false;
    // No status set → treat as transport failure (timeout, abort, DNS).
    return true;
  }
  return false;
}

function backoffDelay(attempt: number, baseMs: number): number {
  // Exponential backoff with full jitter: 1x, 3x, 9x base, ±20%.
  const exp = baseMs * Math.pow(3, attempt - 1);
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.round(exp * jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

  // --- Dashboard ---
  async getDailySummary(
    date?: string,
    locationId?: number,
  ): Promise<DailySummary> {
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

    if (this.mode === 'relay') {
      return this.relayRpc<PaginatedResponse<Product>>(
        RELAY_ACTIONS.PRODUCTS_SEARCH,
        {query: trimmed, page, per_page: perPage, category_id: categoryId},
      );
    }
    const params = new URLSearchParams({
      q: trimmed,
      page: String(page),
      per_page: String(perPage),
    });
    if (categoryId) params.set('category_id', String(categoryId));
    return this.get<PaginatedResponse<Product>>(
      `${API_ENDPOINTS.PRODUCTS_SEARCH}?${params}`,
    );
  }

  async getProductByBarcode(barcode: string): Promise<ProductDetail | null> {
    try {
      if (this.mode === 'relay') {
        return await this.relayRpc<ProductDetail>(
          RELAY_ACTIONS.PRODUCTS_BARCODE,
          {barcode},
        );
      }
      return await this.get<ProductDetail>(
        `${API_ENDPOINTS.PRODUCTS_BARCODE}/${encodeURIComponent(barcode)}`,
      );
    } catch (e) {
      if (isNotFound(e, this.mode)) return null;
      throw e;
    }
  }

  async getProductDetail(productId: number): Promise<ProductDetail | null> {
    try {
      if (this.mode === 'relay') {
        return await this.relayRpc<ProductDetail>(
          RELAY_ACTIONS.PRODUCTS_DETAIL,
          {product_id: productId},
        );
      }
      return await this.get<ProductDetail>(
        `${API_ENDPOINTS.POS_PRODUCTS}/${productId}`,
      );
    } catch (e) {
      if (isNotFound(e, this.mode)) return null;
      throw e;
    }
  }

  async getCategories(): Promise<Category[]> {
    return this.get<Category[]>(API_ENDPOINTS.PRODUCTS_CATEGORIES);
  }

  async getPaymentMethods(): Promise<PaymentMethod[]> {
    return this.get<PaymentMethod[]>(API_ENDPOINTS.POS_PAYMENT_METHODS);
  }

  // --- Inventory ---
  async getStock(
    productId: number,
    locationId?: number,
  ): Promise<StockSnapshot> {
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
    // One key per logical sale, reused on every retry. Gateway dedupes at
    // /api/relay/rpc (and propagates X-Aeris-Idempotency-Key on to the
    // deployment), so retrying with the same key is end-to-end safe.
    const idempotencyKey = generateUuid();
    let lastError: unknown;
    for (let attempt = 1; attempt <= SALE_RETRY.maxAttempts; attempt++) {
      try {
        if (this.mode === 'relay') {
          return await this.relayRpc(RELAY_ACTIONS.SALE_CREATE, data, {
            idempotencyKey,
          });
        }
        return await this.post(API_ENDPOINTS.POS_SALES, data, {
          idempotencyKey,
        });
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
    if (this.mode === 'relay') {
      return this.relayRpc<PaginatedResponse<Sale>>(
        RELAY_ACTIONS.TRANSACTIONS_LIST,
        params || {},
      );
    }
    const urlParams = new URLSearchParams();
    if (params?.page) urlParams.set('page', String(params.page));
    if (params?.per_page) urlParams.set('per_page', String(params.per_page));
    if (params?.date_from) urlParams.set('date_from', params.date_from);
    if (params?.date_to) urlParams.set('date_to', params.date_to);
    const qs = urlParams.toString();
    return this.get<PaginatedResponse<Sale>>(
      `${API_ENDPOINTS.SALES_LIST}${qs ? `?${qs}` : ''}`,
    );
  }

  async getTransactionDetail(saleId: number): Promise<SaleDetail | null> {
    try {
      if (this.mode === 'relay') {
        return await this.relayRpc<SaleDetail>(
          RELAY_ACTIONS.TRANSACTIONS_DETAIL,
          {sale_id: saleId},
        );
      }
      return await this.get<SaleDetail>(
        `${API_ENDPOINTS.SALES_LIST}/${saleId}`,
      );
    } catch (e) {
      if (isNotFound(e, this.mode)) return null;
      throw e;
    }
  }

  async getReceipt(saleId: number): Promise<ReceiptData> {
    if (this.mode === 'relay') {
      return this.relayRpc<ReceiptData>(RELAY_ACTIONS.TRANSACTIONS_RECEIPT, {
        sale_id: saleId,
      });
    }
    return this.get<ReceiptData>(
      `${API_ENDPOINTS.SALES_LIST}/${saleId}/receipt`,
    );
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
    if (this.mode === 'relay') {
      return this.relayRpc<PaginatedResponse<Customer>>(
        RELAY_ACTIONS.CUSTOMERS_SEARCH,
        {query: trimmed, page},
      );
    }
    return this.get<PaginatedResponse<Customer>>(
      `${API_ENDPOINTS.CUSTOMERS_SEARCH}?q=${encodeURIComponent(trimmed)}&page=${page}`,
    );
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
        const err = new Error(`Relay request failed (${response.status})`);
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

function emptyPage<T>(page: number, perPage: number): PaginatedResponse<T> {
  return {
    data: [],
    meta: {current_page: page, last_page: 1, per_page: perPage, total: 0},
  };
}

// Whether an error means "the requested record doesn't exist".
//
// Direct mode: HTTP 404 from the ERP is the canonical "not found".
// Relay mode: HTTP 404 means "no relay_service_config for this service" —
// i.e. the deployment is misconfigured. That MUST surface as an error;
// silently returning null would mask broken deployments as missing records.
// "Record absent" in relay mode comes back as an envelope with
// status=error, error.code=NOT_FOUND.
function isNotFound(err: unknown, mode: ConnectionMode): boolean {
  if (err instanceof RelayError) {
    return err.code === 'NOT_FOUND' || err.code === 'not_found';
  }
  if (
    mode === 'direct' &&
    err &&
    typeof err === 'object' &&
    'status' in err
  ) {
    return (err as {status?: number}).status === 404;
  }
  return false;
}

export default new ApiClient();
