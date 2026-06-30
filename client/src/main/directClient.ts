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
  type AuthResponse,
  type Category,
  type Customer,
  type CustomerCreateInput,
  type CustomerUpdateInput,
  type DailySummary,
  type PaginatedResponse,
  type PaymentMethod,
  type Product,
  type ProductCreateInput,
  type ProductDetail,
  type ProductUpdateInput,
  type ReceiptData,
  type Sale,
  type SaleDetail,
  type StockAdjustment,
  type StockAdjustmentInput,
  type StockSnapshot,
} from '@aeris/shared';
import { randomUUID } from 'node:crypto';

// DirectClient (Electron main) — the Direct/LAN counterpart to the shared
// RelayClient, added by the DR Warm-Failover project (§3.1/§8).
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §3.1, §3.3.
//
// It is a near-port of mobile/src/services/DirectClient.ts: same REST surface
// against the on-prem/NAS deployment (`/api/v1/...`), same @aeris/shared
// normalizers, same single-flight 401-refresh + idempotency-key retry. It
// bypasses the marketplace gateway entirely — genuine peer-to-peer over the
// LAN — so it keeps selling during a true WAN outage. Token confinement is
// unchanged: like the RelayClient, the bearer lives only here in main.
//
// M1 SCOPE: the read + write methods the relayBridge dispatch needs are
// mirrored. Auth (login/refresh) still flows through authManager → the relay
// path in M1; the §14.5 LAN-cert / SPKI-pin verification (§22.2) and the
// Direct-mode re-auth UX are M2 (the mobile review's "non-trivial scoping
// decision", §13) — see the TODOs below.

const DEFAULT_TIMEOUT_MS = 20_000;

// Mirror of RelayClient.assertWritePersisted — bail loudly when a write
// returns no body / {data:null} so a screen surfaces a banner rather than a
// garbage zero-id object.
function assertWritePersisted(raw: unknown): void {
  if (raw === null || raw === undefined) {
    throw new Error("We couldn't save that. Please try again.");
  }
  if (
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    'data' in (raw as Record<string, unknown>) &&
    (raw as { data: unknown }).data == null
  ) {
    throw new Error("We couldn't save that. Please try again.");
  }
}

interface RequestOptions {
  idempotencyKey?: string;
  __retried?: boolean;
}

export class DirectClient {
  private baseUrl = '';
  private authToken: string | null = null;
  private timeoutMs = DEFAULT_TIMEOUT_MS;
  private onUnauthorizedCb: (() => void) | null = null;
  private onRefreshCb: (() => Promise<boolean>) | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  configure(options: { baseUrl?: string; timeoutMs?: number }): void {
    if (options.baseUrl !== undefined) {
      this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    }
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

  getBaseUrl(): string {
    return this.baseUrl;
  }

  // --- Auth (Direct/LAN) — M3-E ---
  // Direct-mode re-entry after an auto failover (M3-C silent re-login). The
  // on-prem/NAS deployment exposes /api/v1/auth/login directly (no gateway),
  // so a silent re-auth in Direct mode posts straight to the LAN edge. The
  // response shape mirrors the relay AuthResponse ({access_token, ...}); the
  // server may wrap it in {data:{...}} like every other Direct read, so we
  // unwrap defensively. We deliberately clear any stale bearer first (login is
  // unauth) so a wrong-audience token can't 401 the login itself.
  async login(
    email: string,
    password: string,
    deviceName?: string,
  ): Promise<AuthResponse> {
    this.authToken = null;
    const raw = await this.post<unknown>('/api/v1/auth/login', {
      email,
      password,
      device_name: deviceName,
    });
    const body =
      raw && typeof raw === 'object' && 'data' in (raw as Record<string, unknown>)
        ? ((raw as { data: unknown }).data as AuthResponse)
        : (raw as AuthResponse);
    return body;
  }

  // --- Dashboard ---
  async getDailySummary(date?: string, locationId?: number): Promise<DailySummary> {
    return withReadRetry(() => {
      const params = new URLSearchParams();
      if (date) params.set('date', date);
      if (locationId) params.set('location_id', String(locationId));
      const qs = params.toString();
      return this.get<DailySummary>(`/api/v1/pos/daily-summary${qs ? `?${qs}` : ''}`);
    });
  }

  // Z-report stays cloud-only by construction (§14.7 Q10). The DirectClient
  // deliberately has NO getDailyZReport — mirroring mobile/src/services/
  // DirectClient.ts — so the full day-close report can never be served by the
  // NAS during a failover and day-close can't be double-owned from the
  // failed-over device. The Direct dispatch refuses sales.daily-summary with a
  // clean 400 (see callDirectDispatch's default branch), and the renderer
  // hides the Z-report screen in Direct mode. Only getDailySummary above (the
  // in-store running total, labelled "In-store totals only") is available.

  // --- Products ---
  async searchProducts(
    query: string,
    page = 1,
    perPage = 20,
  ): Promise<PaginatedResponse<Product>> {
    const trimmed = query.trim();
    if (!trimmed) return emptyPage<Product>(page, perPage);
    return withReadRetry(async () => {
      const params = new URLSearchParams({
        q: trimmed,
        page: String(page),
        per_page: String(perPage),
      });
      const raw = await this.get<PaginatedResponse<unknown>>(
        `/api/v1/products/search?${params}`,
      );
      return { ...raw, data: (raw.data || []).map(normalizeProduct) };
    });
  }

  async listProducts(page = 1, perPage = 50): Promise<PaginatedResponse<Product>> {
    return withReadRetry(async () => {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
      });
      const raw = await this.get<PaginatedResponse<unknown>>(
        `/api/v1/pos/products?${params}`,
      );
      return { ...raw, data: (raw.data || []).map(normalizeProduct) };
    });
  }

  async getProductByBarcode(barcode: string): Promise<ProductDetail | null> {
    return withReadRetry(async () => {
      try {
        const raw = await this.get<unknown>(
          `/api/v1/products/barcode/${encodeURIComponent(barcode)}`,
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
        const raw = await this.get<unknown>(`/api/v1/pos/products/${productId}`);
        return raw == null ? null : normalizeProductDetail(unwrapResource(raw));
      } catch (e) {
        if (isNotFound(e, 'direct')) return null;
        throw e;
      }
    });
  }

  async getCategories(): Promise<Category[]> {
    return withReadRetry(async () => {
      const result = await this.get<unknown>('/api/v1/products/categories');
      return unwrapList<Category>(result);
    });
  }

  async getPaymentMethods(): Promise<PaymentMethod[]> {
    return withReadRetry(async () => {
      const result = await this.get<unknown>('/api/v1/pos/payment-methods');
      return unwrapList<PaymentMethod>(result);
    });
  }

  // --- Inventory ---
  async getStock(productId: number, locationId?: number): Promise<StockSnapshot> {
    return withReadRetry(() => {
      const params = new URLSearchParams({ product_id: String(productId) });
      if (locationId) params.set('location_id', String(locationId));
      return this.get<StockSnapshot>(
        `/api/v1/pos/products/${productId}/stock?${params}`,
      );
    });
  }

  async adjustStock(input: StockAdjustmentInput): Promise<StockAdjustment> {
    const idempotencyKey = randomUUID();
    const payload: Record<string, unknown> = {
      product_id: input.product_id,
      adjustment: input.adjustment,
      reason: input.reason,
      ...(input.notes ? { notes: input.notes } : {}),
      ...(input.location_id != null ? { location_id: input.location_id } : {}),
    };
    return withReadRetry(async () => {
      const raw = await this.post<unknown>(
        '/api/v1/inventory/adjust-stock',
        payload,
        { idempotencyKey },
      );
      assertWritePersisted(raw);
      return normalizeStockAdjustment(unwrapResource(raw));
    });
  }

  // --- Sales ---
  async createSale(
    data: Parameters<
      import('@aeris/shared').RelayClient['createSale']
    >[0],
  ): Promise<{ sale_id: number; sale_number: string; total_cents: number }> {
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
    const subtotal = round2(lineTotalDollars / 1.1);
    const taxAmount = round2(lineTotalDollars - subtotal);
    const totalAmount = centsToDollars(paymentsTotalCents);

    const payload: Record<string, unknown> = {
      items: data.items.map((i) => {
        const rate = i.tax_rate ?? 10;
        return {
          product_id: i.product_id,
          quantity: i.quantity,
          unit_price: centsToDollars(i.unit_price_cents),
          gst_applicable: rate > 0,
          discount_amount: i.discount_cents ? centsToDollars(i.discount_cents) : 0,
        };
      }),
      payments: data.payments.map((p) => ({
        method: p.method,
        amount: centsToDollars(p.amount_cents),
        ...(p.reference ? { reference: p.reference } : {}),
      })),
      subtotal,
      tax_amount: taxAmount,
      total_amount: totalAmount,
    };
    if (data.customer_id !== undefined) payload.customer_id = data.customer_id;
    if (cartDiscountCents > 0) payload.discount_amount = centsToDollars(cartDiscountCents);
    if (data.notes) payload.notes = data.notes;

    const idempotencyKey = randomUUID();
    let lastError: unknown;
    for (let attempt = 1; attempt <= SALE_RETRY.maxAttempts; attempt++) {
      try {
        const result = await this.post('/api/v1/pos/sales', payload, {
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
        if (attempt >= SALE_RETRY.maxAttempts || !isRetryable(e)) throw e;
        await sleep(backoffDelay(attempt, SALE_RETRY.baseDelayMs));
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
      const urlParams = new URLSearchParams();
      if (params?.page) urlParams.set('page', String(params.page));
      if (params?.per_page) urlParams.set('per_page', String(params.per_page));
      if (params?.date_from) urlParams.set('date_from', params.date_from);
      if (params?.date_to) urlParams.set('date_to', params.date_to);
      const qs = urlParams.toString();
      const raw = await this.get<PaginatedResponse<unknown>>(
        `/api/v1/sales${qs ? `?${qs}` : ''}`,
      );
      return { ...raw, data: (raw.data || []).map(normalizeSale) };
    });
  }

  async getTransactionDetail(saleId: number): Promise<SaleDetail | null> {
    return withReadRetry(async () => {
      try {
        const raw = await this.get<unknown>(`/api/v1/sales/${saleId}`);
        return normalizeSaleDetail(unwrapResource(raw));
      } catch (e) {
        if (isNotFound(e, 'direct')) return null;
        throw e;
      }
    });
  }

  async getReceipt(saleId: number): Promise<ReceiptData> {
    return withReadRetry(async () => {
      const raw = await this.get<unknown>(`/api/v1/sales/${saleId}/receipt`);
      return normalizeReceipt(unwrapResource(raw));
    });
  }

  // --- Customers ---
  async searchCustomers(query: string, page = 1): Promise<PaginatedResponse<Customer>> {
    const trimmed = query.trim();
    if (!trimmed) return emptyPage<Customer>(page, 20);
    return withReadRetry(async () => {
      const raw = await this.get<PaginatedResponse<unknown>>(
        `/api/v1/customers/search?q=${encodeURIComponent(trimmed)}&page=${page}`,
      );
      return { ...raw, data: (raw.data || []).map(normalizeCustomer) };
    });
  }

  async listCustomers(page = 1, perPage = 50): Promise<PaginatedResponse<Customer>> {
    return withReadRetry(async () => {
      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
      });
      const raw = await this.get<PaginatedResponse<unknown>>(
        `/api/v1/customers?${params}`,
      );
      return { ...raw, data: (raw.data || []).map(normalizeCustomer) };
    });
  }

  async getCustomerDetail(customerId: number): Promise<Customer | null> {
    return withReadRetry(async () => {
      try {
        const raw = await this.get<unknown>(`/api/v1/customers/${customerId}`);
        return raw == null ? null : normalizeCustomer(unwrapResource(raw));
      } catch (e) {
        if (isNotFound(e, 'direct')) return null;
        throw e;
      }
    });
  }

  async createCustomer(input: CustomerCreateInput): Promise<Customer> {
    const idempotencyKey = randomUUID();
    const payload = toCustomerWirePayload(input);
    let lastError: unknown;
    for (let attempt = 1; attempt <= SALE_RETRY.maxAttempts; attempt++) {
      try {
        const raw = await this.post<unknown>('/api/v1/customers', payload, {
          idempotencyKey,
        });
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

  async updateCustomer(id: number, patch: CustomerUpdateInput): Promise<Customer> {
    const raw = await this.put<unknown>(
      `/api/v1/customers/${id}`,
      toCustomerWirePayload(patch),
    );
    assertWritePersisted(raw);
    return normalizeCustomer(unwrapResource(raw));
  }

  async deleteCustomer(id: number): Promise<{ ok: true }> {
    await this.del(`/api/v1/customers/${id}`);
    return { ok: true };
  }

  // --- Products (writes) ---
  async createProduct(input: ProductCreateInput): Promise<Product> {
    const idempotencyKey = randomUUID();
    const payload = toProductWirePayload(input);
    let lastError: unknown;
    for (let attempt = 1; attempt <= SALE_RETRY.maxAttempts; attempt++) {
      try {
        const raw = await this.post<unknown>('/api/v1/products', payload, {
          idempotencyKey,
        });
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

  async updateProduct(id: number, patch: ProductUpdateInput): Promise<Product> {
    const raw = await this.put<unknown>(
      `/api/v1/products/${id}`,
      toProductWirePayload(patch),
    );
    assertWritePersisted(raw);
    return normalizeProduct(unwrapResource(raw));
  }

  // --- Internal HTTP ---
  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  private post<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }
  private put<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, body, options);
  }
  private del<T = unknown>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    if (!this.baseUrl) {
      const err = new Error('Direct mode has no server URL configured.');
      (err as Error & { status?: number }).status = undefined;
      throw err;
    }
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.authToken) headers.Authorization = `Bearer ${this.authToken}`;
    if (options?.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

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
        (err as Error & { status?: number }).status = 401;
        throw err;
      }

      if (!response.ok) {
        const errorBody = await response.text();
        const err = new Error(`Request failed (${response.status}): ${errorBody}`);
        (err as Error & { status?: number }).status = response.status;
        throw err;
      }

      if (response.status === 204) return undefined as unknown as T;
      const text = await response.text();
      if (!text) return undefined as unknown as T;
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
      } catch {
        /* swallow */
      }
    }
  }
}

// Wire-shape converters mirror the shared RelayClient — strip cents-named
// inputs and re-emit them under the dollar-shape field names the server's
// validators accept.
function toCustomerWirePayload(
  input: CustomerCreateInput | CustomerUpdateInput,
): Record<string, unknown> {
  const { credit_limit_cents, ...rest } = input;
  const out: Record<string, unknown> = { ...rest };
  if (credit_limit_cents != null) {
    out.credit_limit = Math.round(credit_limit_cents) / 100;
  }
  return out;
}

function toProductWirePayload(
  input: ProductCreateInput | ProductUpdateInput,
): Record<string, unknown> {
  const { base_price_cents, cost_price_cents, ...rest } = input;
  const out: Record<string, unknown> = { ...rest };
  if (base_price_cents != null) out.base_price = Math.round(base_price_cents) / 100;
  if (cost_price_cents != null) out.cost_price = Math.round(cost_price_cents) / 100;
  return out;
}
