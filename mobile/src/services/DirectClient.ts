import * as Crypto from 'expo-crypto';
import {
  emptyPage,
  normalizeCustomer,
  normalizeProduct,
  normalizeProductDetail,
  normalizeReceipt,
  normalizeSale,
  normalizeSaleDetail,
  normalizeStockAdjustment,
  unwrapList,
  unwrapResource,
  SALE_RETRY,
  backoffDelay,
  isNotFound,
  isRetryable,
  sleep,
  withReadRetry,
} from '@aeris/shared';
import type {
  AuthResponse,
  BiometricCredential,
  Category,
  Customer,
  CustomerCreateInput,
  CustomerUpdateInput,
  DailySummary,
  PaginatedResponse,
  PaymentMethod,
  Product,
  ProductCreateInput,
  ProductDetail,
  ProductUpdateInput,
  ReceiptData,
  Sale,
  SaleDetail,
  StockAdjustment,
  StockAdjustmentInput,
  StockSnapshot,
} from '../types/api.types';
import {
  API_ENDPOINTS,
  CUSTOMER_BY_ID,
  PRODUCT_BY_ID,
} from '../constants/api';

const DEFAULT_TIMEOUT_MS = 20_000;

// Mirror of RelayClient.assertWritePersisted — bails when a write returns no
// body / {data: null}. Surfaces a friendly banner via a thrown Error so the
// screen doesn't silently "succeed" with a normalized zero-id object.
function assertWritePersisted(raw: unknown): void {
  if (raw === null || raw === undefined) {
    throw new Error("We couldn't save that. Please try again.");
  }
  if (
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    'data' in (raw as Record<string, unknown>) &&
    (raw as {data: unknown}).data == null
  ) {
    throw new Error("We couldn't save that. Please try again.");
  }
}

interface RequestOptions {
  idempotencyKey?: string;
  // Internal-only: prevents 401 retry loops on the refresh leg.
  __retried?: boolean;
}

// Use expo-crypto rather than the Hermes `crypto` global — Hermes does not
// reliably expose `crypto.getRandomValues` across all OS versions, so the
// previous implementation crashed with "crypto not found" on some devices.
function generateUuid(): string {
  return Crypto.randomUUID();
}

export class DirectClient {
  private baseUrl: string = '';
  private authToken: string | null = null;
  private timeoutMs: number = DEFAULT_TIMEOUT_MS;
  private onUnauthorizedCb: (() => void) | null = null;
  // Refresh hook — when set, a 401 on a non-refresh call triggers one
  // attempt at this callback before bouncing the user. See RelayClient
  // for the same mechanic.
  private onRefreshCb: (() => Promise<boolean>) | null = null;
  // Single-flight refresh promise — see RelayClient.refreshPromise for
  // the full rationale. Parallel 401s collapse onto one auth.refresh
  // round-trip so racers can't poison each other.
  private refreshPromise: Promise<boolean> | null = null;

  configure(options: {baseUrl?: string; timeoutMs?: number}): void {
    if (options.baseUrl !== undefined) this.baseUrl = options.baseUrl;
    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      this.timeoutMs = options.timeoutMs;
    }
  }

  setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  getAuthToken(): string | null {
    return this.authToken;
  }

  setOnUnauthorized(cb: (() => void) | null): void {
    this.onUnauthorizedCb = cb;
  }

  setOnRefresh(cb: (() => Promise<boolean>) | null): void {
    this.onRefreshCb = cb;
  }

  // --- Auth ---
  async login(
    email: string,
    password: string,
    deviceName?: string,
  ): Promise<AuthResponse> {
    this.authToken = null;
    return this.post<AuthResponse>(API_ENDPOINTS.AUTH_LOGIN, {
      email,
      password,
      device_name: deviceName,
    });
  }

  async loginBiometric(credential: BiometricCredential): Promise<AuthResponse> {
    return this.post<AuthResponse>(
      `${API_ENDPOINTS.AUTH_LOGIN}/biometric`,
      credential,
    );
  }

  async logout(): Promise<void> {
    if (!this.authToken) return;
    try {
      await this.post(API_ENDPOINTS.AUTH_LOGOUT, {});
    } finally {
      this.authToken = null;
    }
  }

  async refreshToken(): Promise<AuthResponse> {
    return this.post<AuthResponse>('/api/v1/auth/refresh', {});
  }

  // --- Dashboard ---
  async getDailySummary(
    date?: string,
    locationId?: number,
  ): Promise<DailySummary> {
    return withReadRetry(() => {
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (locationId) params.set('location_id', String(locationId));
      const qs = params.toString();
      return this.get<DailySummary>(
        `${API_ENDPOINTS.POS_DAILY_SUMMARY}${qs ? `?${qs}` : ''}`,
      );
    });
  }

  // Rolling top products via N daily-summary fan-out. Mirror of
  // RelayClient.getRollingTopProducts so the ApiClient facade can call
  // it on either backend.
  async getRollingTopProducts(
    days = 30,
    limit = 5,
    locationId?: number,
  ): Promise<DailySummary['top_products']> {
    const dates: string[] = [];
    const today = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i),
      );
      dates.push(d.toISOString().slice(0, 10));
    }

    const CONCURRENCY = 5;
    type TopProduct = DailySummary['top_products'][number];
    const agg = new Map<number, TopProduct>();

    for (let i = 0; i < dates.length; i += CONCURRENCY) {
      const batch = dates.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(date => this.getDailySummary(date, locationId)),
      );
      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        for (const tp of r.value.top_products ?? []) {
          if (!tp || typeof tp.id !== 'number' || typeof tp.name !== 'string') {
            continue;
          }
          const existing = agg.get(tp.id);
          if (existing) {
            existing.quantity = (existing.quantity ?? 0) + (tp.quantity ?? 0);
            existing.revenue_cents =
              (existing.revenue_cents ?? 0) + (tp.revenue_cents ?? 0);
          } else {
            agg.set(tp.id, {
              id: tp.id,
              name: tp.name,
              quantity: tp.quantity ?? 0,
              revenue_cents: tp.revenue_cents ?? 0,
            });
          }
        }
      }
    }

    return Array.from(agg.values())
      .sort((a, b) => (b.quantity ?? 0) - (a.quantity ?? 0))
      .slice(0, limit);
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
      const params = new URLSearchParams({
        q: trimmed,
        page: String(page),
        per_page: String(perPage),
      });
      if (categoryId) params.set('category_id', String(categoryId));
      const raw = await this.get<PaginatedResponse<unknown>>(
        `${API_ENDPOINTS.PRODUCTS_SEARCH}?${params}`,
      );
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
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
      });
      if (categoryId) params.set('category_id', String(categoryId));
      const raw = await this.get<PaginatedResponse<unknown>>(
        `${API_ENDPOINTS.POS_PRODUCTS}?${params}`,
      );
      return {
        ...raw,
        data: (raw.data || []).map(normalizeProduct),
      };
    });
  }

  async getProductByBarcode(barcode: string): Promise<ProductDetail | null> {
    return withReadRetry(async () => {
      try {
        const raw = await this.get<unknown>(
          `${API_ENDPOINTS.PRODUCTS_BARCODE}/${encodeURIComponent(barcode)}`,
        );
        return raw == null ? null : normalizeProductDetail(unwrapResource(raw));
      } catch (e) {
        if (isNotFound(e, 'direct')) return null;
        throw e;
      }
    });
  }

  async getProductDetail(productId: number): Promise<ProductDetail | null> {
    return withReadRetry(async () => {
      try {
        const raw = await this.get<unknown>(
          `${API_ENDPOINTS.POS_PRODUCTS}/${productId}`,
        );
        return raw == null ? null : normalizeProductDetail(unwrapResource(raw));
      } catch (e) {
        if (isNotFound(e, 'direct')) return null;
        throw e;
      }
    });
  }

  async getCategories(): Promise<Category[]> {
    return withReadRetry(async () => {
      const result = await this.get<unknown>(API_ENDPOINTS.PRODUCTS_CATEGORIES);
      return unwrapList<Category>(result);
    });
  }

  async getPaymentMethods(): Promise<PaymentMethod[]> {
    return withReadRetry(async () => {
      const result = await this.get<unknown>(API_ENDPOINTS.POS_PAYMENT_METHODS);
      return unwrapList<PaymentMethod>(result);
    });
  }

  // --- Inventory ---
  async getStock(productId: number, locationId?: number): Promise<StockSnapshot> {
    return withReadRetry(() => {
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
      // tax_rate is a percent integer (10 = 10% GST). Mirrors RelayClient
      // so direct-mode deployments tax 0%-GST lines correctly.
      tax_rate?: number;
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
    const cartDiscountCents = Math.max(0, data.discount_cents ?? 0);
    const lineTotalDollars = centsToDollars(lineTotalCents);
    const subtotal = round2(lineTotalDollars / 1.10);
    const taxAmount = round2(lineTotalDollars - subtotal);
    const totalAmount = centsToDollars(paymentsTotalCents);

    const payload: Record<string, unknown> = {
      items: data.items.map(i => {
        // tax_rate undefined → 10% default (matches Aeris2 server default).
        const rate = i.tax_rate ?? 10;
        return {
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: centsToDollars(i.unit_price_cents),
          gst_applicable: rate > 0,
          discount_amount: i.discount_cents ? centsToDollars(i.discount_cents) : 0,
        };
      }),
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

    const idempotencyKey = generateUuid();
    let lastError: unknown;
    for (let attempt = 1; attempt <= SALE_RETRY.maxAttempts; attempt++) {
      try {
        const result = await this.post(API_ENDPOINTS.POS_SALES, payload, {
          idempotencyKey,
        });
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
        if (attempt >= SALE_RETRY.maxAttempts || !isRetryable(e)) {
          throw e;
        }
        const delay = backoffDelay(attempt, SALE_RETRY.baseDelayMs);
        // Dev-only retry trace — production builds drop this. Logs the
        // idempotency key (not PII) so a developer can correlate retry
        // attempts to a single logical sale in the Metro/Xcode console.
        if (__DEV__) {
          console.log(
            `[sale] retry ${attempt}/${SALE_RETRY.maxAttempts - 1} ` +
              `after ${delay}ms idem=${idempotencyKey}`,
          );
        }
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
    product_id?: number;
  }): Promise<PaginatedResponse<Sale>> {
    return withReadRetry(async () => {
      const urlParams = new URLSearchParams();
      if (params?.page) urlParams.set('page', String(params.page));
      if (params?.per_page) urlParams.set('per_page', String(params.per_page));
      if (params?.date_from) urlParams.set('date_from', params.date_from);
      if (params?.date_to) urlParams.set('date_to', params.date_to);
      if (params?.product_id) {
        urlParams.set('product_id', String(params.product_id));
      }
      const qs = urlParams.toString();
      const raw = await this.get<PaginatedResponse<unknown>>(
        `${API_ENDPOINTS.SALES_LIST}${qs ? `?${qs}` : ''}`,
      );
      return {
        ...raw,
        data: (raw.data || []).map(normalizeSale),
      };
    });
  }

  async getTransactionDetail(saleId: number): Promise<SaleDetail | null> {
    return withReadRetry(async () => {
      try {
        const raw = await this.get<unknown>(
          `${API_ENDPOINTS.SALES_LIST}/${saleId}`,
        );
        return normalizeSaleDetail(unwrapResource(raw));
      } catch (e) {
        if (isNotFound(e, 'direct')) return null;
        throw e;
      }
    });
  }

  async getReceipt(saleId: number): Promise<ReceiptData> {
    return withReadRetry(async () => {
      const raw = await this.get<unknown>(
        `${API_ENDPOINTS.SALES_LIST}/${saleId}/receipt`,
      );
      return normalizeReceipt(unwrapResource(raw));
    });
  }

  // Direct (LAN) mode counterpart of RelayClient.getInvoicePdfUrl. Same
  // contract from the mobile caller's POV — returns {url, expires_at} —
  // but goes straight to the deployment with the Sanctum bearer because
  // /api/relay/rpc requires an HMAC the on-prem app doesn't hold.
  async getInvoicePdfUrl(
    saleId: number,
  ): Promise<{url: string; expires_at: string}> {
    return this.get<{url: string; expires_at: string}>(
      `${API_ENDPOINTS.SALES_LIST}/${saleId}/invoice-pdf-url`,
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
    return withReadRetry(async () => {
      const raw = await this.get<PaginatedResponse<unknown>>(
        `${API_ENDPOINTS.CUSTOMERS_SEARCH}?q=${encodeURIComponent(trimmed)}&page=${page}`,
      );
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
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
      });
      const raw = await this.get<PaginatedResponse<unknown>>(
        `${API_ENDPOINTS.CUSTOMERS_LIST}?${params}`,
      );
      return {
        ...raw,
        data: (raw.data || []).map(normalizeCustomer),
      };
    });
  }

  async getCustomerDetail(customerId: number): Promise<Customer | null> {
    return withReadRetry(async () => {
      try {
        const raw = await this.get<unknown>(
          `${API_ENDPOINTS.CUSTOMERS_LIST}/${customerId}`,
        );
        return raw == null ? null : normalizeCustomer(unwrapResource(raw));
      } catch (e) {
        if (isNotFound(e, 'direct')) return null;
        throw e;
      }
    });
  }

  // --- Customers (writes) ---
  // Mirrors RelayClient.createCustomer — retries on transient 5xx with the
  // same Idempotency-Key so a doubled tap during a network hiccup still
  // creates one row server-side.
  async createCustomer(input: CustomerCreateInput): Promise<Customer> {
    const idempotencyKey = generateUuid();
    const payload = toCustomerWirePayload(input);
    let lastError: unknown;
    for (let attempt = 1; attempt <= SALE_RETRY.maxAttempts; attempt++) {
      try {
        const raw = await this.post<unknown>(
          API_ENDPOINTS.CUSTOMERS,
          payload,
          {idempotencyKey},
        );
        assertWritePersisted(raw);
        return normalizeCustomer(unwrapResource(raw));
      } catch (e) {
        lastError = e;
        if (attempt >= SALE_RETRY.maxAttempts || !isRetryable(e)) throw e;
        await sleep(backoffDelay(attempt, SALE_RETRY.baseDelayMs));
      }
    }
    throw lastError;
  }

  // PUT is idempotent at the HTTP layer, but we deliberately do NOT retry —
  // surfacing validation/conflict errors to the caller matches createSale's
  // policy and avoids silent re-writes if the server returned 4xx mid-retry.
  async updateCustomer(
    id: number,
    patch: CustomerUpdateInput,
  ): Promise<Customer> {
    const raw = await this.put<unknown>(
      CUSTOMER_BY_ID(id),
      toCustomerWirePayload(patch),
    );
    assertWritePersisted(raw);
    return normalizeCustomer(unwrapResource(raw));
  }

  // CustomerController::destroy returns 204; our request helper short-circuits
  // an empty body. Return a stable {ok: true} sentinel so callers don't have
  // to deal with void vs null differences across transports.
  async deleteCustomer(id: number): Promise<{ok: true}> {
    await this.delete(CUSTOMER_BY_ID(id));
    return {ok: true};
  }

  // --- Products (writes) ---
  async createProduct(input: ProductCreateInput): Promise<Product> {
    const idempotencyKey = generateUuid();
    const payload = toProductWirePayload(input);
    let lastError: unknown;
    for (let attempt = 1; attempt <= SALE_RETRY.maxAttempts; attempt++) {
      try {
        const raw = await this.post<unknown>(
          API_ENDPOINTS.PRODUCTS,
          payload,
          {idempotencyKey},
        );
        assertWritePersisted(raw);
        return normalizeProduct(unwrapResource(raw));
      } catch (e) {
        lastError = e;
        if (attempt >= SALE_RETRY.maxAttempts || !isRetryable(e)) throw e;
        await sleep(backoffDelay(attempt, SALE_RETRY.baseDelayMs));
      }
    }
    throw lastError;
  }

  async updateProduct(
    id: number,
    patch: ProductUpdateInput,
  ): Promise<Product> {
    const raw = await this.put<unknown>(
      PRODUCT_BY_ID(id),
      toProductWirePayload(patch),
    );
    assertWritePersisted(raw);
    return normalizeProduct(unwrapResource(raw));
  }

  // --- Inventory (writes) ---
  // adjustStock is wrapped in withReadRetry because each retry attempt sends
  // the same Idempotency-Key — server-side dedupe (once wired) collapses
  // repeats so a transient 5xx won't double-adjust the on_hand count.
  async adjustStock(input: StockAdjustmentInput): Promise<StockAdjustment> {
    const idempotencyKey = generateUuid();
    const payload: Record<string, unknown> = {
      product_id: input.product_id,
      adjustment: input.adjustment,
      reason: input.reason,
      ...(input.notes ? {notes: input.notes} : {}),
      ...(input.location_id !== undefined && input.location_id !== null
        ? {location_id: input.location_id}
        : {}),
    };
    return withReadRetry(async () => {
      const raw = await this.post<unknown>(
        API_ENDPOINTS.INVENTORY_ADJUST_STOCK,
        payload,
        {idempotencyKey},
      );
      assertWritePersisted(raw);
      return normalizeStockAdjustment(unwrapResource(raw));
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

  private put<T>(
    path: string,
    body: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return this.request<T>('PUT', path, body, options);
  }

  private delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
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
        // Routine token expiry — try a one-shot refresh + retry before
        // wiping the session. The refresh endpoint itself is exempt so a
        // genuine "can't refresh" condition still bounces the user. Same
        // mechanic as RelayClient — see RelayClient.relayRpc for context.
        // Parallel 401s share `refreshPromise` so they collapse onto ONE
        // refresh round-trip and all retry with the same fresh bearer.
        const isRefresh = path === '/api/v1/auth/refresh';
        if (
          !isRefresh &&
          !options?.__retried &&
          this.onRefreshCb !== null &&
          this.authToken !== null
        ) {
          if (!this.refreshPromise) {
            const cb = this.onRefreshCb;
            this.refreshPromise = (async () => {
              try {
                return await cb();
              } catch {
                return false;
              }
            })().finally(() => {
              this.refreshPromise = null;
            });
          }
          const refreshed = await this.refreshPromise;
          if (refreshed) {
            return this.request<T>(method, path, body, {
              ...options,
              __retried: true,
            });
          }
        }
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

      // 204 No Content (e.g. CustomerController::destroy) carries no body —
      // surface `undefined` so DELETE callers can resolve cleanly without
      // tripping over an empty-body JSON parse.
      if (response.status === 204) {
        return undefined as unknown as T;
      }
      const text = await response.text();
      if (!text) {
        return undefined as unknown as T;
      }
      return JSON.parse(text) as T;
    } finally {
      clearTimeout(timeout);
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

// Wire-shape converters mirror RelayClient.toCustomerWirePayload /
// toProductWirePayload. The server's Store*/Update*Request validators only
// accept dollar-shape fields (credit_limit, base_price, cost_price); strip
// the cents-named inputs and re-emit them under the dollar names so a single
// typed CustomerCreateInput/ProductCreateInput works on both transports.
function toCustomerWirePayload(
  input: CustomerCreateInput | CustomerUpdateInput,
): Record<string, unknown> {
  const {credit_limit_cents, ...rest} = input;
  const out: Record<string, unknown> = {...rest};
  if (credit_limit_cents !== undefined && credit_limit_cents !== null) {
    out.credit_limit = Math.round(credit_limit_cents) / 100;
  }
  return out;
}

function toProductWirePayload(
  input: ProductCreateInput | ProductUpdateInput,
): Record<string, unknown> {
  const {base_price_cents, cost_price_cents, ...rest} = input;
  const out: Record<string, unknown> = {...rest};
  if (base_price_cents !== undefined && base_price_cents !== null) {
    out.base_price = Math.round(base_price_cents) / 100;
  }
  if (cost_price_cents !== undefined && cost_price_cents !== null) {
    out.cost_price = Math.round(cost_price_cents) / 100;
  }
  return out;
}
