import * as Crypto from 'expo-crypto';
import {
  emptyPage,
  normalizeCustomer,
  normalizePendingRepair,
  normalizeProduct,
  normalizeProductDetail,
  normalizeReceipt,
  normalizeRepair,
  normalizeRepairDetail,
  normalizeRepairStatusHistory,
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
  RefundError,
  classifyRefundError,
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
  PendingRepair,
  Product,
  ProductCreateInput,
  ProductDetail,
  ProductUpdateInput,
  ReceiptData,
  Refund,
  RefundParams,
  RefundResponse,
  Repair,
  RepairCreateInput,
  RepairDetail,
  RepairItem,
  RepairPriority,
  RepairStatus,
  RepairStatusHistory,
  RepairUpdateInput,
  Sale,
  SaleDetail,
  StockAdjustment,
  StockAdjustmentInput,
  StockSnapshot,
  Supplier,
} from '../types/api.types';
import {
  API_ENDPOINTS,
  CUSTOMER_BY_ID,
  POS_PENDING_REPAIRS_BY_CUSTOMER,
  PRODUCT_BY_ID,
  REPAIR_BULK_STATUS,
  REPAIR_BY_ID,
  REPAIR_ITEMS,
  REPAIR_ITEM_BY_ID,
  REPAIR_STATUS,
  REPAIR_STATUS_HISTORY,
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
    if (options.baseUrl !== undefined) {
      // Defence-in-depth: SettingsModal validates URLs interactively, but a
      // corrupted persisted payload or a programmatic saveSettings() could
      // still land a bogus baseUrl here — which would then get suffixed with
      // an auth bearer on every request. Reject anything that isn't a valid
      // http(s) URL. An empty string is legal (means "not configured yet";
      // request() will fail loudly on the first call).
      const trimmed = options.baseUrl.trim();
      if (trimmed === '') {
        this.baseUrl = '';
      } else {
        try {
          const parsed = new URL(trimmed);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('invalid scheme');
          }
          this.baseUrl = trimmed;
        } catch {
          console.warn('DirectClient.configure: rejecting invalid baseUrl', trimmed);
          // Leave the existing baseUrl in place rather than clearing it —
          // a bad settings write shouldn't disconnect a working session.
        }
      }
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

  async getSuppliers(): Promise<Supplier[]> {
    return withReadRetry(async () => {
      try {
        const result = await this.get<unknown>(API_ENDPOINTS.PRODUCTS_SUPPLIERS);
        return unwrapList<Supplier>(result);
      } catch (e) {
        // Symmetric with RelayClient.getSuppliers: swallow NOT_FOUND so any
        // future consumer (PO screen, catalog filters) doesn't hard-crash on
        // an older deployment that hasn't shipped the endpoint yet.
        if (isNotFound(e, 'direct')) return [];
        throw e;
      }
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

  // Direct (LAN) mode counterpart of RelayClient.refundSale. Hits the
  // deployment directly at POST /api/v1/sales/{sale_id}/refund — no relay
  // envelope, the controller's {success, message, data} comes back at the
  // top level. HTTP status carries the rejection reason (403/409/422/429);
  // we translate into RefundError for parity with the relay path so UI
  // code can branch on `err.kind` regardless of transport.
  async refundSale(params: RefundParams): Promise<RefundResponse> {
    const {sale_id, idempotency_key, ...rest} = params;
    const body: Record<string, unknown> = {
      ...rest,
      // Server's contract field — keep it in the body even though we also
      // send it as a header so dedupe collapses at every layer.
      idempotency_key,
    };
    try {
      const raw = await this.post<unknown>(
        `${API_ENDPOINTS.SALES_LIST}/${sale_id}/refund`,
        body,
        {idempotencyKey: idempotency_key},
      );
      if (!raw || typeof raw !== 'object') {
        throw new RefundError(
          'Refund could not be processed.',
          'unknown',
          null,
          null,
        );
      }
      const parsed = raw as {
        success?: boolean;
        message?: string;
        data?: {
          refund?: Refund;
          sale?: unknown;
          idempotent_replay?: boolean;
        };
      };
      // Defensive: direct mode normally returns HTTP 4xx for rejections
      // (handled in catch below), but a controller could in theory return
      // 200 with success:false; honour the inner flag either way.
      if (parsed.success === false) {
        const msg = parsed.message || 'Refund could not be processed.';
        throw new RefundError(msg, classifyRefundError(msg), null, null);
      }
      if (!parsed.data || !parsed.data.refund || !parsed.data.sale) {
        throw new RefundError(
          'Refund could not be processed.',
          'unknown',
          null,
          null,
        );
      }
      return {
        success: true,
        message: parsed.message || 'Refund processed successfully',
        data: {
          refund: parsed.data.refund,
          sale: normalizeSaleDetail(unwrapResource(parsed.data.sale)),
          idempotent_replay: parsed.data.idempotent_replay === true,
        },
      };
    } catch (e) {
      if (e instanceof RefundError) throw e;
      // Translate HTTP 4xx from this.request() into RefundError. The
      // request helper attaches `.status` (and `.correlationId` when the
      // server emits X-Request-Id / X-Correlation-Id) and the original
      // body sits at the tail of the error message (after `: `).
      const err = e as Error & {status?: number; correlationId?: string};
      const status = typeof err.status === 'number' ? err.status : null;
      const correlationId = err.correlationId || null;
      if (status === 403 || status === 409 || status === 422 || status === 429) {
        let message = 'Refund could not be processed.';
        // Try to extract the server's message from the formatted Error.
        // request() throws "Request failed (${status}): ${body}".
        const colonIdx = (err.message || '').indexOf(': ');
        if (colonIdx >= 0) {
          const tail = err.message.slice(colonIdx + 2);
          try {
            const parsed = JSON.parse(tail) as {message?: string};
            if (parsed && typeof parsed.message === 'string') {
              message = parsed.message;
            }
          } catch {
            // Non-JSON body — keep the generic message.
          }
        }
        throw new RefundError(
          message,
          classifyRefundError(message, status),
          status,
          correlationId,
        );
      }
      throw e;
    }
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

  // --- Repairs ---
  // Twins of RelayClient.* — same read/write shapes, same idempotency policy.
  // Goes straight to the deployment's /api/v1/repairs/* routes (no envelope).

  async listRepairs(
    page = 1,
    perPage = 20,
    filters?: {
      status?: RepairStatus;
      customer_id?: number;
      assigned_to?: number;
      location_id?: number;
      priority?: RepairPriority;
      date_from?: string;
      date_to?: string;
    },
  ): Promise<PaginatedResponse<Repair>> {
    return withReadRetry(async () => {
      try {
        const params = new URLSearchParams({
          page: String(page),
          per_page: String(perPage),
        });
        if (filters?.status) params.set('status', filters.status);
        if (filters?.customer_id !== undefined) {
          params.set('customer_id', String(filters.customer_id));
        }
        if (filters?.assigned_to !== undefined) {
          params.set('assigned_to', String(filters.assigned_to));
        }
        if (filters?.location_id !== undefined) {
          params.set('location_id', String(filters.location_id));
        }
        if (filters?.priority) params.set('priority', String(filters.priority));
        if (filters?.date_from) params.set('date_from', filters.date_from);
        if (filters?.date_to) params.set('date_to', filters.date_to);
        const qs = params.toString();
        const raw = await this.get<PaginatedResponse<unknown>>(
          `${API_ENDPOINTS.REPAIRS}${qs ? `?${qs}` : ''}`,
        );
        return {
          ...raw,
          data: (raw.data || []).map(normalizeRepair),
        };
      } catch (e) {
        if (isNotFound(e, 'direct')) return emptyPage<Repair>(page, perPage);
        throw e;
      }
    });
  }

  async getRepairDetail(id: number): Promise<RepairDetail | null> {
    return withReadRetry(async () => {
      try {
        const raw = await this.get<unknown>(REPAIR_BY_ID(id));
        return raw == null ? null : normalizeRepairDetail(unwrapResource(raw));
      } catch (e) {
        if (isNotFound(e, 'direct')) return null;
        throw e;
      }
    });
  }

  async getRepairStatusHistory(
    repairId: number,
  ): Promise<RepairStatusHistory[]> {
    return withReadRetry(async () => {
      try {
        const result = await this.get<unknown>(REPAIR_STATUS_HISTORY(repairId));
        return unwrapList<unknown>(result).map(normalizeRepairStatusHistory);
      } catch (e) {
        if (isNotFound(e, 'direct')) return [];
        throw e;
      }
    });
  }

  async getPendingRepairsForCustomer(
    customerId: number,
  ): Promise<PendingRepair[]> {
    return withReadRetry(async () => {
      try {
        const result = await this.get<unknown>(
          POS_PENDING_REPAIRS_BY_CUSTOMER(customerId),
        );
        const list = unwrapList<unknown>(result);
        if (list.length > 0) return list.map(normalizePendingRepair);
        // Older `{success, repairs: [...], count}` shape — see the sibling
        // relay method for the same fallback.
        if (result && typeof result === 'object') {
          const r = result as Record<string, unknown>;
          if (Array.isArray(r.repairs)) {
            return (r.repairs as unknown[]).map(normalizePendingRepair);
          }
        }
        return [];
      } catch (e) {
        if (isNotFound(e, 'direct')) return [];
        throw e;
      }
    });
  }

  async createRepair(input: RepairCreateInput): Promise<RepairDetail> {
    const idempotencyKey = generateUuid();
    let lastError: unknown;
    for (let attempt = 1; attempt <= SALE_RETRY.maxAttempts; attempt++) {
      try {
        const raw = await this.post<unknown>(
          API_ENDPOINTS.REPAIRS,
          {...input},
          {idempotencyKey},
        );
        assertWritePersisted(raw);
        return normalizeRepairDetail(unwrapResource(raw));
      } catch (e) {
        lastError = e;
        if (attempt >= SALE_RETRY.maxAttempts || !isRetryable(e)) throw e;
        await sleep(backoffDelay(attempt, SALE_RETRY.baseDelayMs));
      }
    }
    throw lastError;
  }

  async updateRepair(
    id: number,
    input: RepairUpdateInput,
  ): Promise<RepairDetail> {
    const raw = await this.put<unknown>(REPAIR_BY_ID(id), {...input});
    assertWritePersisted(raw);
    return normalizeRepairDetail(unwrapResource(raw));
  }

  async updateRepairStatus(
    id: number,
    status: RepairStatus,
    notes?: string,
  ): Promise<RepairDetail> {
    const raw = await this.post<unknown>(REPAIR_STATUS(id), {
      status,
      ...(notes !== undefined ? {notes} : {}),
    });
    assertWritePersisted(raw);
    return normalizeRepairDetail(unwrapResource(raw));
  }

  async addRepairItem(
    repairId: number,
    item: {
      item_type: RepairItem['item_type'];
      item_name: string;
      quantity: number;
      unit_price: number;
      product_id?: number | null;
      item_sku?: string | null;
      notes?: string | null;
    },
  ): Promise<RepairDetail> {
    const idempotencyKey = generateUuid();
    // Defensive: line_total is server-computed; never wire it.
    const payload: Record<string, unknown> = {
      item_type: item.item_type,
      item_name: item.item_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      ...(item.product_id !== undefined && item.product_id !== null
        ? {product_id: item.product_id}
        : {}),
      ...(item.item_sku !== undefined && item.item_sku !== null
        ? {item_sku: item.item_sku}
        : {}),
      ...(item.notes !== undefined && item.notes !== null
        ? {notes: item.notes}
        : {}),
    };
    let lastError: unknown;
    for (let attempt = 1; attempt <= SALE_RETRY.maxAttempts; attempt++) {
      try {
        const raw = await this.post<unknown>(REPAIR_ITEMS(repairId), payload, {
          idempotencyKey,
        });
        assertWritePersisted(raw);
        return normalizeRepairDetail(unwrapResource(raw));
      } catch (e) {
        lastError = e;
        if (attempt >= SALE_RETRY.maxAttempts || !isRetryable(e)) throw e;
        await sleep(backoffDelay(attempt, SALE_RETRY.baseDelayMs));
      }
    }
    throw lastError;
  }

  async updateRepairItem(
    repairId: number,
    itemId: number,
    patch: {
      quantity?: number;
      unit_price?: number;
      notes?: string | null;
      status?: RepairItem['status'];
    },
  ): Promise<RepairDetail> {
    const raw = await this.put<unknown>(
      REPAIR_ITEM_BY_ID(repairId, itemId),
      {...patch},
    );
    assertWritePersisted(raw);
    return normalizeRepairDetail(unwrapResource(raw));
  }

  async removeRepairItem(
    repairId: number,
    itemId: number,
  ): Promise<RepairDetail> {
    // Item removal returns the updated parent repair (server chooses the
    // parent-resource echo shape so the client has an authoritative snapshot
    // without a follow-up fetch). Current contract is 200 + RepairResource
    // body — but if a future server flip returns 204 (matching destroy()
    // elsewhere in Aeris2), request() short-circuits to undefined and
    // assertWritePersisted would falsely fail. Fall back to a parent fetch
    // so the caller always gets an authoritative RepairDetail even under
    // that server shape change.
    const raw = await this.delete<unknown>(REPAIR_ITEM_BY_ID(repairId, itemId));
    if (raw === undefined || raw === null) {
      const parent = await this.getRepairDetail(repairId);
      if (parent === null) {
        throw new Error(`Repair ${repairId} not found after item removal`);
      }
      return parent;
    }
    assertWritePersisted(raw);
    return normalizeRepairDetail(unwrapResource(raw));
  }

  async bulkUpdateRepairStatus(
    repairIds: number[],
    status: RepairStatus,
    notes?: string,
  ): Promise<{succeeded: number[]; skipped: number[]}> {
    const raw = await this.post<unknown>(REPAIR_BULK_STATUS, {
      repair_ids: repairIds,
      status,
      ...(notes !== undefined ? {notes} : {}),
    });
    assertWritePersisted(raw);
    const requested = new Set(repairIds);
    // Peek through the list-envelope before unwrapResource, which
    // deliberately refuses to unwrap arrays. Mirrors RelayClient.
    let inner: unknown = raw;
    if (
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      'data' in (raw as Record<string, unknown>)
    ) {
      const d = (raw as {data: unknown}).data;
      inner = Array.isArray(d) ? d : unwrapResource<unknown>(raw);
    } else {
      inner = unwrapResource<unknown>(raw);
    }
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      const r = inner as Record<string, unknown>;
      const succeededRaw = (r.succeeded ?? r.updated_ids) as unknown;
      const skippedRaw = (r.skipped ?? r.skipped_ids) as unknown;
      if (Array.isArray(succeededRaw)) {
        const succeeded = succeededRaw
          .map(v => (typeof v === 'number' ? v : Number(v)))
          .filter(v => Number.isFinite(v));
        let skipped = Array.isArray(skippedRaw)
          ? skippedRaw
              .map(v => (typeof v === 'number' ? v : Number(v)))
              .filter(v => Number.isFinite(v))
          : repairIds.filter(id => !succeeded.includes(id));
        // Empty succeeded + empty skipped when the caller requested >0 ids
        // means the server acknowledged but reported nothing usable — treat
        // as fully skipped rather than lying to the UI. Mirrors RelayClient.
        if (succeeded.length === 0 && skipped.length === 0 && repairIds.length > 0) {
          skipped = [...repairIds];
        }
        return {succeeded, skipped};
      }
    }
    if (Array.isArray(inner)) {
      const succeeded: number[] = [];
      for (const row of inner) {
        if (!row || typeof row !== 'object') continue;
        const rawId = (row as Record<string, unknown>).id;
        const id = typeof rawId === 'number' ? rawId : Number(rawId);
        if (Number.isFinite(id) && requested.has(id)) succeeded.push(id);
      }
      const skipped = repairIds.filter(id => !succeeded.includes(id));
      return {succeeded, skipped};
    }
    return {succeeded: [], skipped: [...repairIds]};
  }

  async deleteRepair(id: number): Promise<void> {
    try {
      await this.delete(REPAIR_BY_ID(id));
    } catch (e) {
      if (isNotFound(e, 'direct')) return;
      throw e;
    }
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
        // Forward any request-trace header if the deployment emits one.
        // Aeris2 doesn't ship a RequestId middleware today, so this is
        // forward-compatible: when/if the server starts emitting an
        // X-Correlation-Id or X-Request-Id, RefundError.correlationId
        // will populate automatically and ops can pivot from a mobile
        // bug report into the audit_logs row (see MOBILE_SALES_REFUND.md
        // §audit log). Until then, direct-mode cid stays null.
        const cid =
          response.headers.get('x-correlation-id') ||
          response.headers.get('x-request-id');
        if (cid) {
          (err as Error & {correlationId?: string}).correlationId = cid;
        }
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
