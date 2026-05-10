import * as Crypto from 'expo-crypto';
import {
  emptyPage,
  normalizeCustomer,
  normalizeProduct,
  normalizeProductDetail,
  normalizeReceipt,
  normalizeSale,
  normalizeSaleDetail,
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
  DailySummary,
  PaginatedResponse,
  PaymentMethod,
  Product,
  ProductDetail,
  ReceiptData,
  Sale,
  SaleDetail,
  StockSnapshot,
} from '../types/api.types';
import {API_ENDPOINTS} from '../constants/api';

const DEFAULT_TIMEOUT_MS = 20_000;

interface RequestOptions {
  idempotencyKey?: string;
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
      const urlParams = new URLSearchParams();
      if (params?.page) urlParams.set('page', String(params.page));
      if (params?.per_page) urlParams.set('per_page', String(params.per_page));
      if (params?.date_from) urlParams.set('date_from', params.date_from);
      if (params?.date_to) urlParams.set('date_to', params.date_to);
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
