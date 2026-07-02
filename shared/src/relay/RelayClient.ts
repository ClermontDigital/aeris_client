import {RELAY_ACTIONS} from '../constants/actions';
import {validateWorkspaceCode} from '../constants/config';
import type {
  AuthResponse,
  BiometricCredential,
  Category,
  Customer,
  CustomerCreateInput,
  CustomerUpdateInput,
  DailySummary,
  DailyZReport,
  DrRoutingPayload,
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
  RelayEnvelope,
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
  normalizeZReport,
  unwrapList,
  unwrapResource,
} from '../normalizers';
import {RelayError} from './RelayError';
import {RefundError, classifyRefundError} from './RefundError';
import {
  SALE_RETRY,
  backoffDelay,
  isNotFound,
  isRetryable,
  sleep,
  withReadRetry,
} from './retry';
import {generateUuid} from './uuid';

const DEFAULT_TIMEOUT_MS = 20_000;
const RELAY_BUFFER_MS = 3_000; // client waits this long beyond server-side timeout

// Write actions are expected to return the persisted entity (Aeris2 resource
// wrapped in {data: {...}}). If we instead get null/undefined or {data: null},
// the dispatcher accepted the request but the entity didn't persist — exactly
// the failure mode the marketplace team has hit before. Bail loudly so the
// caller's screen surfaces a banner instead of silently "succeeding" with a
// garbage normalized object.
function assertWritePersisted(raw: unknown, action: string): void {
  if (raw === null || raw === undefined) {
    throw new RelayError(
      "We couldn't save that. Please try again.",
      'EMPTY_RESPONSE',
      null,
      action,
    );
  }
  if (
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    'data' in (raw as Record<string, unknown>) &&
    (raw as {data: unknown}).data == null
  ) {
    throw new RelayError(
      "We couldn't save that. Please try again.",
      'EMPTY_RESPONSE',
      null,
      action,
    );
  }
}

interface RequestOptions {
  idempotencyKey?: string;
  // Internal-only: set true on the retry leg of a 401 → refresh → retry
  // sequence so we don't loop forever if the refreshed bearer also 401s.
  __retried?: boolean;
}

export class RelayClient {
  private relayUrl: string = 'https://api.aeris.team';
  private authToken: string | null = null;
  private timeoutMs: number = DEFAULT_TIMEOUT_MS;
  private onUnauthorizedCb: (() => void) | null = null;
  // Caller-supplied refresh hook. When set, a 401 on a NON-refresh action
  // triggers one attempt at this callback before bouncing the user. The
  // callback should call refreshToken() under the hood, persist the new
  // token, call setAuthToken(), and return true on success. Any throw or
  // false is treated as "refresh failed" → onUnauthorized fires.
  private onRefreshCb: (() => Promise<boolean>) | null = null;
  // Caller-supplied reachability hook (DR §14.7 Q9 / M-R1). Fired on EVERY
  // transport response so the cascade's cloud-reachability signal is driven by
  // normal traffic (product fetch / dashboard / all RPC), not only the
  // refresh-token path. `reachable=true` means the server ANSWERED (HTTP 200
  // envelope, app-level error envelope, 401, or any non-gateway HTTP status —
  // a 4xx is still "the cloud is up"); `reachable=false` means a transport /
  // gateway failure (502/503/504, envelope timeout, fetch abort/network).
  private onResponseCb: ((reachable: boolean) => void) | null = null;
  // Single-flight refresh: when multiple in-flight calls all 401 at once
  // (e.g. Dashboard's Promise.all on cold-start), they must collapse onto
  // ONE refresh round-trip and all retry with the resulting token. Without
  // this, parallel callers race the store mutation: one wins the refresh,
  // commits the new bearer; the other reads the store mid-`clearLocalSession`
  // and sees null → fires `handleUnauthorized` → wipes the freshly-minted
  // session out from under the first caller. That race was the actual cause
  // of "after a day my saved login bounces me back to the sign-in screen
  // even with Keep Me Signed In ticked".
  private refreshPromise: Promise<boolean> | null = null;
  private workspaceCode: string = '';

  configure(options: {
    relayUrl?: string;
    timeoutMs?: number;
    workspaceCode?: string;
  }): void {
    if (options.relayUrl !== undefined) this.relayUrl = options.relayUrl;
    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      this.timeoutMs = options.timeoutMs;
    }
    if (options.workspaceCode !== undefined) {
      if (options.workspaceCode === '') {
        this.workspaceCode = '';
      } else if (validateWorkspaceCode(options.workspaceCode) !== null) {
        console.warn('Invalid workspace code passed to RelayClient.configure(); ignoring.');
        this.workspaceCode = '';
      } else {
        this.workspaceCode = options.workspaceCode;
      }
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

  // DR §14.7 Q9 / M-R1 reachability reporting. The platform layer wires this
  // to its cloud-reachability store so the §19.2 routing cascade sees a live
  // signal from ordinary traffic. Optional — unset on clients that don't run
  // DR (e.g. desktop without failover wiring).
  setOnResponse(cb: ((reachable: boolean) => void) | null): void {
    this.onResponseCb = cb;
  }

  // Report a transport outcome to the reachability hook. Wrapped so a throwing
  // callback can never break the request path. `reachable=true` ⇒ server
  // answered (incl. 4xx/app-error); `false` ⇒ transport/gateway failure.
  private reportReachable(reachable: boolean): void {
    if (!this.onResponseCb) return;
    try {
      this.onResponseCb(reachable);
    } catch (cbErr) {
      console.warn('onResponse callback threw:', cbErr);
    }
  }

  getWorkspaceCode(): string {
    return this.workspaceCode;
  }

  // The relay/marketplace base URL (e.g. https://api.aeris.team). Exposed so
  // the mobile-only product-image upload transport can target the dedicated
  // /api/v1/products/image/* gateway routes — which are NOT /api/relay/rpc
  // calls and therefore can't go through relayRpc. R2 is marketplace-owned,
  // so the image upload path always uses THIS base even when the app is in
  // 'direct' (LAN) mode.
  getRelayUrl(): string {
    return this.relayUrl;
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
    return this.relayRpc<AuthResponse>(RELAY_ACTIONS.AUTH_LOGIN, {
      email,
      password,
      device_name: deviceName,
    });
  }

  // NOTE: auth.biometric is NOT on the marketplace gateway's unauth allow-list
  // (only auth.login is). It must run in user-traffic mode — i.e. the caller
  // must already hold a valid session token. We deliberately DO NOT clear
  // authToken here: that would guarantee a 401.
  async loginBiometric(credential: BiometricCredential): Promise<AuthResponse> {
    return this.relayRpc<AuthResponse>(
      RELAY_ACTIONS.AUTH_BIOMETRIC,
      credential as unknown as Record<string, unknown>,
    );
  }

  async logout(): Promise<void> {
    // No-op when there's nothing to revoke — avoids firing
    // `Authorization: Bearer null` and a guaranteed 401 against the server.
    if (!this.authToken) return;
    try {
      await this.relayRpc(RELAY_ACTIONS.AUTH_LOGOUT, {});
    } finally {
      this.authToken = null;
    }
  }

  // Mints a fresh Sanctum token off the current bearer. Caller is responsible
  // for persisting the new token + expires_at and calling setAuthToken().
  // Failures (401, network) propagate so the caller can decide whether to
  // wipe the session (proactive expired path) or simply log and retry later.
  async refreshToken(): Promise<AuthResponse> {
    return this.relayRpc<AuthResponse>(RELAY_ACTIONS.AUTH_REFRESH, {});
  }

  // --- DR (NAS warm-failover, M3-0) ---
  // Fetch the deployment's cached DR routing state (option B delivery seam).
  // Runs as ordinary authenticated user-traffic over the existing relay.
  //
  // GRACEFUL "no DR" CONTRACT (§3 guardrail 1): a flag-off / non-DR deployment
  // either has no `dr` relay_service_config (gateway answers HTTP 404 with a
  // non-envelope body → plain Error with .status=404) OR the route is
  // unregistered and the deployment replies NOT_FOUND (envelope error). BOTH
  // mean "no DR routing available" → return null so the caller falls back to
  // the M2 manual path. We also map dr_enabled=false to null for the same
  // reason. Any OTHER error (auth, timeout, malformed) propagates — a broken
  // deployment must not be silently masked as "no DR".
  async getDrRouting(): Promise<DrRoutingPayload | null> {
    let raw: unknown;
    try {
      raw = await this.relayRpc<unknown>(RELAY_ACTIONS.DR_ROUTING, {});
    } catch (err) {
      // Deployment-404 (no `dr` service config) — non-envelope HTTP error.
      const status = (err as {status?: number} | null)?.status;
      if (status === 404) return null;
      // Route-proxied not-found envelope (NOT_FOUND / not_found code).
      if (isNotFound(err, 'relay')) return null;
      throw err;
    }
    const payload = this.coerceDrRouting(raw);
    if (!payload || !payload.dr_enabled) return null;
    return payload;
  }

  // M3 — DR presence beat (route-proxied dr.presence). The client posts
  // {device_id, mode} over the relay; the Aeris2 deployment forwards it to the
  // gateway's tenant-key-only /dr/presence beacon under its own tenant key, so
  // a per-device live count is real WITHOUT the client holding a tenant key.
  //
  // BEST-EFFORT / FIRE-AND-FORGET: never throws to the caller. A flag-off /
  // non-DR deployment has no `dr` relay_service_config → deployment-404 /
  // NOT_FOUND envelope; a deployment that hasn't shipped the presence proxy →
  // 405/404. ALL non-2xx (and any transport error) are swallowed here and
  // reported as `false` so a presence beat never surfaces an error to the
  // cashier. Returns true only on a clean relay round-trip.
  async reportDrPresence(beat: {
    device_id: string;
    mode: 'cloud' | 'local';
  }): Promise<boolean> {
    try {
      // Wire-vocabulary map (cross-repo contract): the client routing vocab is
      // 'local' (on-LAN / Direct) vs 'cloud', but the Aeris2 dr.presence registry
      // + validator speak 'direct' vs 'cloud' (DrPresenceRegistry::MODE_DIRECT,
      // RoutingController validate `in:direct,cloud`). Without this map a real
      // beat sends mode='local' → 422 → swallowed → the live dr_presence count
      // never increments. Map at the boundary so the server accepts it.
      const mode = beat.mode === 'local' ? 'direct' : 'cloud';
      await this.relayRpc(RELAY_ACTIONS.DR_PRESENCE, {
        device_id: beat.device_id,
        mode,
      });
      return true;
    } catch {
      // Silent no-op on ANY failure (404/405 flag-off, NOT_FOUND, transport).
      return false;
    }
  }

  // Defensive coercion of the dr.routing envelope `data` into the typed
  // contract. A malformed body returns null (treated as "no DR"). Keeps the
  // shape tolerant so an additive server-side field never crashes the client.
  private coerceDrRouting(raw: unknown): DrRoutingPayload | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const routingTarget = r.routing_target === 'local' ? 'local' : 'cloud';
    return {
      dr_enabled: r.dr_enabled === true,
      routing_target: routingTarget,
      partner_local_url:
        typeof r.partner_local_url === 'string' && r.partner_local_url.length > 0
          ? r.partner_local_url
          : null,
      partner_local_url_reported_at:
        typeof r.partner_local_url_reported_at === 'string'
          ? r.partner_local_url_reported_at
          : null,
      active_writer: r.active_writer === true,
      failback_eligible: r.failback_eligible === true,
      sync_queue_depth:
        typeof r.sync_queue_depth === 'number' && Number.isFinite(r.sync_queue_depth)
          ? r.sync_queue_depth
          : 0,
      served_at:
        typeof r.served_at === 'string' ? r.served_at : new Date().toISOString(),
    };
  }

  // --- Dashboard ---
  async getDailySummary(
    date?: string,
    locationId?: number,
  ): Promise<DailySummary> {
    return withReadRetry(() =>
      this.relayRpc<DailySummary>(RELAY_ACTIONS.DASHBOARD_SUMMARY, {
        date,
        location_id: locationId,
      }),
    );
  }

  // Top products aggregated over a rolling window. The marketplace dispatcher
  // has no native range aggregation, so we fan out N calls to dashboard.summary
  // (one per day) and aggregate client-side. Concurrency is capped at 5 to
  // avoid hammering the relay. Days for which the summary fetch fails are
  // simply skipped — partial data is better than nothing.
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
          // Skip malformed entries — defensive against schema drift since
          // we're aggregating across many responses.
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
      const raw = await this.relayRpc<PaginatedResponse<unknown>>(
        RELAY_ACTIONS.PRODUCTS_SEARCH,
        {query: trimmed, page, per_page: perPage, category_id: categoryId},
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
      const raw = await this.relayRpc<PaginatedResponse<unknown>>(
        RELAY_ACTIONS.PRODUCTS_LIST,
        {page, per_page: perPage, category_id: categoryId},
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
        // `code` alias is the placeholder name in the dispatcher route
        // `/api/v1/products/barcode/{code}`; sending both keys is what
        // the proposed dispatcher fix expects so this auto-lights-up.
        const raw = await this.relayRpc<unknown>(
          RELAY_ACTIONS.PRODUCTS_BARCODE,
          {barcode, code: barcode},
        );
        return raw == null ? null : normalizeProductDetail(unwrapResource(raw));
      } catch (e) {
        if (isNotFound(e, 'relay')) return null;
        throw e;
      }
    });
  }

  async getProductDetail(productId: number): Promise<ProductDetail | null> {
    return withReadRetry(async () => {
      try {
        const raw = await this.relayRpc<unknown>(
          RELAY_ACTIONS.PRODUCTS_DETAIL,
          {product_id: productId, id: productId},
        );
        return raw == null ? null : normalizeProductDetail(unwrapResource(raw));
      } catch (e) {
        if (isNotFound(e, 'relay')) return null;
        throw e;
      }
    });
  }

  async getCategories(): Promise<Category[]> {
    return withReadRetry(async () => {
      const result = await this.relayRpc<unknown>(RELAY_ACTIONS.PRODUCTS_CATEGORIES, {});
      return unwrapList<Category>(result);
    });
  }

  // Suppliers list — feeds the item-edit "supplier" picker on mobile.
  // Aeris2 exposes GET /api/v1/products/suppliers; the marketplace dispatcher
  // may not route this action yet, so we swallow NOT_FOUND and return an empty
  // list. The picker treats [] as "supplier selection unavailable in this
  // build" rather than an error state.
  async getSuppliers(): Promise<Supplier[]> {
    return withReadRetry(async () => {
      try {
        const result = await this.relayRpc<unknown>(
          RELAY_ACTIONS.PRODUCTS_SUPPLIERS,
          {},
        );
        return unwrapList<Supplier>(result);
      } catch (err) {
        if (isNotFound(err, 'relay')) return [];
        throw err;
      }
    });
  }

  async getPaymentMethods(): Promise<PaymentMethod[]> {
    return withReadRetry(async () => {
      const result = await this.relayRpc<unknown>(RELAY_ACTIONS.POS_PAYMENT_METHODS, {});
      // First try the canonical {data: [...]} / bare-array shape.
      const list = unwrapList<PaymentMethod>(result);
      if (list.length > 0) return list;
      // Deployments have surfaced two alternative shapes in the wild:
      //   - {data: {data: [...]}} — Aeris2 Resource collection wrapped
      //     in the relay envelope's own `data:` (double-wrapped).
      //   - {payment_methods: [...]} — older controllers that returned
      //     a named key instead of the canonical collection shape.
      // We try both before settling for an empty array (which would
      // trigger the offline-defaults fallback on the checkout screen).
      if (result && typeof result === 'object') {
        const r = result as Record<string, unknown>;
        const inner = r.data;
        if (inner && typeof inner === 'object' && 'data' in inner) {
          const nested = (inner as Record<string, unknown>).data;
          if (Array.isArray(nested)) return nested as PaymentMethod[];
        }
        if (Array.isArray(r.payment_methods)) {
          return r.payment_methods as PaymentMethod[];
        }
      }
      return [];
    });
  }

  // --- Inventory ---
  async getStock(productId: number, locationId?: number): Promise<StockSnapshot> {
    return withReadRetry(() =>
      this.relayRpc<StockSnapshot>(RELAY_ACTIONS.INVENTORY_STOCK, {
        product_id: productId,
        location_id: locationId,
      }),
    );
  }

  // --- Sales ---
  async createSale(data: {
    items: Array<{
      product_id: number;
      quantity: number;
      unit_price_cents: number;
      discount_cents?: number;
      // tax_rate is a percent integer (10 = 10% GST). Defaults to 10 when
      // undefined to match Aeris2 StoreProductRequest::prepareForValidation.
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
    // Public signature stays in cents; convert to the dollar-shape that
    // Aeris2's POSController::processSale (mapped from sale.create) expects.
    // ProcessSaleRequest validates required dollar fields (unit_price,
    // amount, subtotal, total_amount) and runs a cross-field math check
    // that demands subtotal == sum(qty * unit_price_ex_gst - discount_ex_gst)
    // ±0.02. gst_applicable is derived per-line from item.tax_rate so a
    // 0% product doesn't get split as 1.10/inc by the server.
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

    // One key per logical sale, reused on every retry. Gateway dedupes at
    // /api/relay/rpc (and propagates X-Aeris-Idempotency-Key on to the
    // deployment), so retrying with the same key is end-to-end safe.
    const idempotencyKey = generateUuid();
    let lastError: unknown;
    for (let attempt = 1; attempt <= SALE_RETRY.maxAttempts; attempt++) {
      try {
        const result = await this.relayRpc(RELAY_ACTIONS.SALE_CREATE, payload, {
          idempotencyKey,
        });
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
    // Defensive product filter — Aeris2's transactions.list will honour
    // `product_id` once the controller wiring lands. Sending it now means
    // ProductDetail's "Recent sales" section auto-lights-up the day the
    // server filter ships, with no mobile push needed.
    product_id?: number;
  }): Promise<PaginatedResponse<Sale>> {
    const page = params?.page ?? 1;
    const perPage = params?.per_page ?? 20;
    return withReadRetry(async () => {
      try {
        const raw = await this.relayRpc<PaginatedResponse<unknown>>(
          RELAY_ACTIONS.TRANSACTIONS_LIST,
          params || {},
        );
        return {
          ...raw,
          data: (raw.data || []).map(normalizeSale),
        };
      } catch (e) {
        // Server returns NOT_FOUND when there are no transactions matching
        // the filter (rather than `{data: [], meta: {total: 0}}`). Treat
        // it as an empty page so a fresh install / unfiltered "no sales
        // yet" surfaces the empty-state UI instead of a server error.
        if (isNotFound(e, 'relay')) return emptyPage<Sale>(page, perPage);
        throw e;
      }
    });
  }

  async getTransactionDetail(saleId: number): Promise<SaleDetail | null> {
    return withReadRetry(async () => {
      try {
        const raw = await this.relayRpc<unknown>(
          RELAY_ACTIONS.TRANSACTIONS_DETAIL,
          {sale_id: saleId, id: saleId},
        );
        return normalizeSaleDetail(unwrapResource(raw));
      } catch (e) {
        if (isNotFound(e, 'relay')) return null;
        throw e;
      }
    });
  }

  async getReceipt(saleId: number): Promise<ReceiptData> {
    return withReadRetry(async () => {
      // `id` alias mirrors the dispatcher placeholder for /api/v1/sales/{id}/receipt;
      // see reference_marketplace_dispatcher_bug.md.
      const raw = await this.relayRpc<unknown>(RELAY_ACTIONS.TRANSACTIONS_RECEIPT, {
        sale_id: saleId,
        id: saleId,
      });
      return normalizeReceipt(unwrapResource(raw));
    });
  }

  // Marketplace mints a short-lived signed URL the mobile client can use
  // to download the rendered invoice PDF directly from the tenant's
  // deployment (which may be acme.aeris.team, demo.aeris.team, aeris.local,
  // etc — treat `url` as opaque). The signature IS the auth; the
  // subsequent PDF fetch must NOT carry an Authorization header.
  // TTL is enforced server-side at 2 minutes.
  async getInvoicePdfUrl(
    saleId: number,
  ): Promise<{url: string; expires_at: string}> {
    return this.relayRpc<{url: string; expires_at: string}>(
      RELAY_ACTIONS.SALES_INVOICE_PDF_URL,
      {sale_id: saleId},
    );
  }

  // Process a refund against a completed sale. The marketplace dispatcher
  // wraps SalesAPIController::refund's response inside the relay envelope's
  // `data` field — see MOBILE_SALES_REFUND.md "Relay envelope wrapper" for
  // the exact double-nesting. The controller's 4xx responses (403 access,
  // 409 idempotency conflict, 422 validation rejection) come back as
  // envelope.status: "success" with `success: false` nested inside, so
  // this method MUST inspect the inner `success` flag and translate
  // failures into a typed RefundError for UI branching.
  //
  // `idempotency_key` is required — caller mints a UUID per refund attempt
  // (via expo-crypto.randomUUID on the mobile UI layer) and reuses it on
  // retry. A same-key + different-body retry returns HTTP 409 (kind:
  // 'conflict'); the UI should not auto-mint a new key and retry, instead
  // require the user to re-open the sheet which will produce a fresh UUID.
  async refundSale(params: RefundParams): Promise<RefundResponse> {
    // Send Idempotency-Key both in the body (server's contract field) and
    // in the header (marketplace gateway dedupe). Same string for both so
    // a retry collapses cleanly at both layers.
    //
    // Use relayRpcEnvelope (not relayRpc) so we can pass the envelope's
    // correlation_id into any RefundError we throw — ops pivots from the
    // cid into the audit_logs row for the refund attempt (HIGH-severity,
    // one row per try). See MOBILE_SALES_REFUND.md §audit log.
    const {data: result, correlationId} = await this.relayRpcEnvelope<unknown>(
      RELAY_ACTIONS.SALES_REFUND,
      // Spread params so optional fields only land on the wire when set.
      // sale_id is the dispatcher alias for the {sale_id} route placeholder.
      {...params},
      {idempotencyKey: params.idempotency_key},
    );

    // result IS the controller's response body
    // ({success, message, data: {refund, sale, idempotent_replay}}).
    if (!result || typeof result !== 'object') {
      throw new RefundError(
        'Refund could not be processed.',
        'unknown',
        null,
        correlationId,
      );
    }
    const body = result as {
      success?: boolean;
      message?: string;
      data?: {
        refund?: Refund;
        sale?: unknown;
        idempotent_replay?: boolean;
      };
    };

    if (body.success === false) {
      const msg = body.message || 'Refund could not be processed.';
      throw new RefundError(msg, classifyRefundError(msg), null, correlationId);
    }

    // Defensive: dispatcher returned success but no payload (shouldn't
    // happen given the contract, but other actions have surfaced this
    // failure mode before).
    if (!body.data || !body.data.refund || !body.data.sale) {
      throw new RefundError(
        'Refund could not be processed.',
        'unknown',
        null,
        correlationId,
      );
    }

    return {
      success: true,
      message: body.message || 'Refund processed successfully',
      data: {
        refund: body.data.refund,
        sale: normalizeSaleDetail(unwrapResource(body.data.sale)),
        idempotent_replay: body.data.idempotent_replay === true,
      },
    };
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
      const raw = await this.relayRpc<PaginatedResponse<unknown>>(
        RELAY_ACTIONS.CUSTOMERS_SEARCH,
        {query: trimmed, term: trimmed, page},
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
      const raw = await this.relayRpc<PaginatedResponse<unknown>>(
        RELAY_ACTIONS.CUSTOMERS_LIST,
        {page, per_page: perPage},
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
        const raw = await this.relayRpc<unknown>(
          RELAY_ACTIONS.CUSTOMERS_DETAIL,
          {customer_id: customerId, id: customerId},
        );
        return raw == null ? null : normalizeCustomer(unwrapResource(raw));
      } catch (e) {
        if (isNotFound(e, 'relay')) return null;
        throw e;
      }
    });
  }

  // Server-side dedupe on this action isn't yet wired; sending the
  // Idempotency-Key is defence-in-depth so a double-clicked Save won't
  // create two rows once the gateway lights up dedupe for create paths.
  async createCustomer(input: CustomerCreateInput): Promise<Customer> {
    const idempotencyKey = generateUuid();
    const payload = this.toCustomerWirePayload(input);
    let lastError: unknown;
    for (let attempt = 1; attempt <= SALE_RETRY.maxAttempts; attempt++) {
      try {
        const raw = await this.relayRpc<unknown>(
          RELAY_ACTIONS.CUSTOMERS_CREATE,
          payload,
          {idempotencyKey},
        );
        assertWritePersisted(raw, RELAY_ACTIONS.CUSTOMERS_CREATE);
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
    const raw = await this.relayRpc<unknown>(RELAY_ACTIONS.CUSTOMERS_UPDATE, {
      ...this.toCustomerWirePayload(patch),
      customer_id: id,
      id,
    });
    assertWritePersisted(raw, RELAY_ACTIONS.CUSTOMERS_UPDATE);
    return normalizeCustomer(unwrapResource(raw));
  }

  // CustomerController::destroy returns 204 on success — the dispatcher
  // converts that to {data: null}. Surface a stable {ok: true} sentinel.
  async deleteCustomer(id: number): Promise<{ok: true}> {
    await this.relayRpc<unknown>(RELAY_ACTIONS.CUSTOMERS_DELETE, {
      customer_id: id,
      id,
    });
    return {ok: true};
  }

  // --- Products (write) ---
  // Defence-in-depth idempotency key — see createCustomer note above.
  async createProduct(input: ProductCreateInput): Promise<Product> {
    const idempotencyKey = generateUuid();
    const payload = this.toProductWirePayload(input);
    let lastError: unknown;
    for (let attempt = 1; attempt <= SALE_RETRY.maxAttempts; attempt++) {
      try {
        const raw = await this.relayRpc<unknown>(
          RELAY_ACTIONS.PRODUCTS_CREATE,
          payload,
          {idempotencyKey},
        );
        assertWritePersisted(raw, RELAY_ACTIONS.PRODUCTS_CREATE);
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
    const raw = await this.relayRpc<unknown>(RELAY_ACTIONS.PRODUCTS_UPDATE, {
      ...this.toProductWirePayload(patch),
      product_id: id,
      id,
    });
    assertWritePersisted(raw, RELAY_ACTIONS.PRODUCTS_UPDATE);
    return normalizeProduct(unwrapResource(raw));
  }

  // --- Inventory (write) ---
  // Adjusting stock records a StockMovement; sending the same Idempotency-Key
  // on a retried request lets the gateway dedupe rather than double-adjust.
  async adjustStock(input: StockAdjustmentInput): Promise<StockAdjustment> {
    const idempotencyKey = generateUuid();
    let lastError: unknown;
    for (let attempt = 1; attempt <= SALE_RETRY.maxAttempts; attempt++) {
      try {
        const raw = await this.relayRpc<unknown>(
          RELAY_ACTIONS.INVENTORY_ADJUST_STOCK,
          {
            product_id: input.product_id,
            adjustment: input.adjustment,
            reason: input.reason,
            ...(input.notes ? {notes: input.notes} : {}),
            ...(input.location_id !== undefined && input.location_id !== null
              ? {location_id: input.location_id}
              : {}),
          },
          {idempotencyKey},
        );
        assertWritePersisted(raw, RELAY_ACTIONS.INVENTORY_ADJUST_STOCK);
        return normalizeStockAdjustment(unwrapResource(raw));
      } catch (e) {
        lastError = e;
        if (attempt >= SALE_RETRY.maxAttempts || !isRetryable(e)) throw e;
        await sleep(backoffDelay(attempt, SALE_RETRY.baseDelayMs));
      }
    }
    throw lastError;
  }

  // --- Repairs ---
  //
  // The `workspace.features.repairs_enabled` flag on AuthResponse gates the
  // whole surface CLIENT-SIDE — the ApiClient facade guards every call with a
  // `deployment-repairs-disabled` catch and flips the workspaceFeaturesStore
  // off so the tab yanks itself. RelayClient stays neutral about the flag:
  // callers that reach these methods are already past the gate.
  //
  // Marketplace dispatcher entries for the 12 actions are still pending on the
  // gateway; while they're missing the RPC will come back as a NOT_FOUND
  // envelope. Read paths swallow that into `[]`/`null`/`emptyPage`; writes let
  // it surface so the UI can show "not available" instead of pretending it
  // worked. Symmetric with getSuppliers / getTransactions patterns above.

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
        const raw = await this.relayRpc<PaginatedResponse<unknown>>(
          RELAY_ACTIONS.REPAIRS_LIST,
          {page, per_page: perPage, ...(filters || {})},
        );
        return {
          ...raw,
          data: (raw.data || []).map(normalizeRepair),
        };
      } catch (e) {
        // Dispatcher not yet wired / no rows matching the filter — surface an
        // empty page so the screen renders its empty state instead of an
        // error banner. Mirrors getTransactions.
        if (isNotFound(e, 'relay')) return emptyPage<Repair>(page, perPage);
        throw e;
      }
    });
  }

  async getRepairDetail(id: number): Promise<RepairDetail | null> {
    return withReadRetry(async () => {
      try {
        const raw = await this.relayRpc<unknown>(
          RELAY_ACTIONS.REPAIRS_DETAIL,
          {repair_id: id, id},
        );
        return raw == null ? null : normalizeRepairDetail(unwrapResource(raw));
      } catch (e) {
        if (isNotFound(e, 'relay')) return null;
        throw e;
      }
    });
  }

  async getRepairStatusHistory(
    repairId: number,
  ): Promise<RepairStatusHistory[]> {
    return withReadRetry(async () => {
      try {
        const result = await this.relayRpc<unknown>(
          RELAY_ACTIONS.REPAIRS_STATUS_HISTORY,
          {repair_id: repairId, id: repairId},
        );
        // Server shape is {data: [...]} per RepairResource's statusHistory
        // relation; unwrapList tolerates both the wrapped and bare-array
        // forms.
        return unwrapList<unknown>(result).map(normalizeRepairStatusHistory);
      } catch (e) {
        if (isNotFound(e, 'relay')) return [];
        throw e;
      }
    });
  }

  async getPendingRepairsForCustomer(
    customerId: number,
  ): Promise<PendingRepair[]> {
    return withReadRetry(async () => {
      try {
        const result = await this.relayRpc<unknown>(
          RELAY_ACTIONS.REPAIRS_PENDING_FOR_CUSTOMER,
          {customer_id: customerId, id: customerId},
        );
        // POS-scoped endpoint answers with either the canonical `{data: [...]}`
        // envelope OR the older `{success, repairs: [...], count}` shape. Try
        // canonical first, then fall back to the `repairs` key.
        const list = unwrapList<unknown>(result);
        if (list.length > 0) return list.map(normalizePendingRepair);
        if (result && typeof result === 'object') {
          const r = result as Record<string, unknown>;
          if (Array.isArray(r.repairs)) {
            return (r.repairs as unknown[]).map(normalizePendingRepair);
          }
        }
        return [];
      } catch (e) {
        if (isNotFound(e, 'relay')) return [];
        throw e;
      }
    });
  }

  // POST /api/v1/repairs — StoreRepairRequest mirror. Retries with the same
  // Idempotency-Key so a doubled tap creates ONE row. Returns the full detail
  // (StoreRepairRequest response includes items + status_history seeded from
  // the initial 'pending' state) so the caller can navigate straight into the
  // repair-detail screen without a follow-up fetch.
  async createRepair(input: RepairCreateInput): Promise<RepairDetail> {
    const idempotencyKey = generateUuid();
    let lastError: unknown;
    for (let attempt = 1; attempt <= SALE_RETRY.maxAttempts; attempt++) {
      try {
        const raw = await this.relayRpc<unknown>(
          RELAY_ACTIONS.REPAIRS_CREATE,
          {...input},
          {idempotencyKey},
        );
        assertWritePersisted(raw, RELAY_ACTIONS.REPAIRS_CREATE);
        return normalizeRepairDetail(unwrapResource(raw));
      } catch (e) {
        lastError = e;
        if (attempt >= SALE_RETRY.maxAttempts || !isRetryable(e)) throw e;
        await sleep(backoffDelay(attempt, SALE_RETRY.baseDelayMs));
      }
    }
    throw lastError;
  }

  // PUT /api/v1/repairs/{id}. Full partial — customer_id is deliberately not
  // in RepairUpdateInput (Aeris2 ignores it on update). Aliased id per the
  // marketplace dispatcher placeholder pattern.
  async updateRepair(
    id: number,
    input: RepairUpdateInput,
  ): Promise<RepairDetail> {
    const raw = await this.relayRpc<unknown>(RELAY_ACTIONS.REPAIRS_UPDATE, {
      ...input,
      repair_id: id,
      id,
    });
    assertWritePersisted(raw, RELAY_ACTIONS.REPAIRS_UPDATE);
    return normalizeRepairDetail(unwrapResource(raw));
  }

  // POST /api/v1/repairs/{id}/status — the server enforces the allowed
  // transition set (App\Enums\RepairStatus::allowedTransitions), so callers
  // should let a 422 propagate rather than pre-checking.
  async updateRepairStatus(
    id: number,
    status: RepairStatus,
    notes?: string,
  ): Promise<RepairDetail> {
    const raw = await this.relayRpc<unknown>(
      RELAY_ACTIONS.REPAIRS_UPDATE_STATUS,
      {
        repair_id: id,
        id,
        status,
        ...(notes !== undefined ? {notes} : {}),
      },
    );
    assertWritePersisted(raw, RELAY_ACTIONS.REPAIRS_UPDATE_STATUS);
    return normalizeRepairDetail(unwrapResource(raw));
  }

  // POST /api/v1/repairs/{id}/items — server computes `line_total` from
  // quantity * unit_price, so callers MUST NOT send it (the wire shape
  // documents this at api.types.ts). Idempotency key defended so a double
  // tap doesn't add two identical line rows.
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
    // Defensive strip — line_total is server-computed; if a caller accidentally
    // passes it through a spread we'd fail the server's forbidden-field check.
    // Not typed on the parameter, but strip defensively at the boundary.
    const payload: Record<string, unknown> = {
      repair_id: repairId,
      id: repairId,
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
        const raw = await this.relayRpc<unknown>(
          RELAY_ACTIONS.REPAIRS_ADD_ITEM,
          payload,
          {idempotencyKey},
        );
        assertWritePersisted(raw, RELAY_ACTIONS.REPAIRS_ADD_ITEM);
        return normalizeRepairDetail(unwrapResource(raw));
      } catch (e) {
        lastError = e;
        if (attempt >= SALE_RETRY.maxAttempts || !isRetryable(e)) throw e;
        await sleep(backoffDelay(attempt, SALE_RETRY.baseDelayMs));
      }
    }
    throw lastError;
  }

  // PUT /api/v1/repairs/{repair_id}/items/{item_id}. line_total remains
  // server-computed. Send BOTH `repair_id`/`id` AND `item_id`/`itemId` so
  // the dispatcher route-placeholder mapping lights up regardless of which
  // key it expects.
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
    const raw = await this.relayRpc<unknown>(RELAY_ACTIONS.REPAIRS_UPDATE_ITEM, {
      ...patch,
      repair_id: repairId,
      id: repairId,
      item_id: itemId,
    });
    assertWritePersisted(raw, RELAY_ACTIONS.REPAIRS_UPDATE_ITEM);
    return normalizeRepairDetail(unwrapResource(raw));
  }

  // DELETE /api/v1/repairs/{repair_id}/items/{item_id}. Returns the updated
  // repair detail (server responds with the parent resource so the client
  // has an authoritative post-delete snapshot without a follow-up fetch).
  // If a future server flip returns 204 (relay serialises to {data: null}),
  // fall back to a parent detail fetch instead of the misleading
  // assertWritePersisted failure — mirrors DirectClient behaviour.
  async removeRepairItem(
    repairId: number,
    itemId: number,
  ): Promise<RepairDetail> {
    const raw = await this.relayRpc<unknown>(RELAY_ACTIONS.REPAIRS_REMOVE_ITEM, {
      repair_id: repairId,
      id: repairId,
      item_id: itemId,
    });
    const unwrapped = unwrapResource<unknown>(raw);
    if (unwrapped === null || unwrapped === undefined) {
      const parent = await this.getRepairDetail(repairId);
      if (parent === null) {
        throw new Error(`Repair ${repairId} not found after item removal`);
      }
      return parent;
    }
    assertWritePersisted(raw, RELAY_ACTIONS.REPAIRS_REMOVE_ITEM);
    return normalizeRepairDetail(unwrapped);
  }

  // POST /api/v1/repairs/bulk-status. Server-side contract has been through a
  // few iterations, so we accept ANY of:
  //   1. `{succeeded: [ids], skipped: [ids]}` — canonical.
  //   2. `{updated_ids: [...], skipped_ids: [...]}` — older alias.
  //   3. Array of repair objects — the server just echoes the accepted rows,
  //      and the client must diff against `requested`.
  // Falling back to a client-side diff future-proofs the UI: whichever shape
  // the server settles on, this method returns the same summary.
  async bulkUpdateRepairStatus(
    repairIds: number[],
    status: RepairStatus,
    notes?: string,
  ): Promise<{succeeded: number[]; skipped: number[]}> {
    const raw = await this.relayRpc<unknown>(RELAY_ACTIONS.REPAIRS_BULK_STATUS, {
      repair_ids: repairIds,
      status,
      ...(notes !== undefined ? {notes} : {}),
    });
    assertWritePersisted(raw, RELAY_ACTIONS.REPAIRS_BULK_STATUS);
    const requested = new Set(repairIds);
    // Peek through a `{data: [...]}` list-envelope before unwrapResource,
    // since unwrapResource explicitly refuses to unwrap arrays (it's a
    // resource unwrapper). Callers of the bulk endpoint have surfaced BOTH
    // the resource-envelope (single object) AND the list-envelope
    // (array of repairs) shapes on the wire.
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
    // Shape 1 / 2 — try both canonical + alias key names.
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
          : // Server only reported succeeded — diff against requested.
            repairIds.filter(id => !succeeded.includes(id));
        // Guard against the "server acknowledged with {succeeded: [], skipped: []}"
        // shape. Both arrays empty means the server reported nothing usable —
        // return every requested id as skipped rather than lying to the UI.
        if (succeeded.length === 0 && skipped.length === 0 && repairIds.length > 0) {
          skipped = [...repairIds];
        }
        return {succeeded, skipped};
      }
    }
    // Shape 3 — array of repair objects. Diff against requested.
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
    // Fallback — server acknowledged but returned nothing usable. Treat every
    // requested id as skipped rather than lying to the UI.
    return {succeeded: [], skipped: [...repairIds]};
  }

  // DELETE /api/v1/repairs/{id}. RepairController::destroy returns 204 →
  // {data: null}, so we deliberately do NOT call assertWritePersisted (mirrors
  // deleteCustomer). Also swallows NOT_FOUND — the user asked us to delete a
  // record that's already gone, which is the desired outcome.
  async deleteRepair(id: number): Promise<void> {
    try {
      await this.relayRpc<unknown>(RELAY_ACTIONS.REPAIRS_DELETE, {
        repair_id: id,
        id,
      });
    } catch (e) {
      if (isNotFound(e, 'relay')) return;
      throw e;
    }
  }

  // --- Sales (Z-report) ---
  async getDailyZReport(
    date?: string,
    locationId?: number,
  ): Promise<DailyZReport> {
    return withReadRetry(async () => {
      const raw = await this.relayRpc<unknown>(
        RELAY_ACTIONS.SALES_DAILY_SUMMARY,
        {date, location_id: locationId},
      );
      return normalizeZReport(unwrapResource(raw));
    });
  }

  // --- Wire-shape converters ---
  // Passthrough-everything-except-cents so a new typed field automatically
  // flows to the server without needing a converter touch-up. Cents-named
  // fields are stripped and re-emitted under their dollar-shape names.
  private toCustomerWirePayload(
    input: CustomerCreateInput | CustomerUpdateInput,
  ): Record<string, unknown> {
    const {credit_limit_cents, ...rest} = input;
    const out: Record<string, unknown> = {...rest};
    if (credit_limit_cents !== undefined && credit_limit_cents !== null) {
      out.credit_limit = Math.round(credit_limit_cents) / 100;
    }
    return out;
  }

  // Same passthrough-with-cents-stripped pattern as toCustomerWirePayload.
  private toProductWirePayload(
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

  // --- Relay RPC ---
  // Server-side timeout is sent in seconds. Client fetch waits a small buffer
  // longer so we aren't aborting before the relay has a chance to respond.
  //
  // Thin shim over relayRpcEnvelope — most callers only need the action's
  // data payload, not the envelope metadata. Callers that DO need the
  // correlation_id (e.g. refundSale, for audit-log pivoting) should call
  // relayRpcEnvelope directly.
  private async relayRpc<T>(
    action: string,
    params: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const {data} = await this.relayRpcEnvelope<T>(action, params, options);
    return data;
  }

  // Envelope-aware variant. Returns the action's data plus the
  // correlation_id so callers that throw typed errors can attach the cid
  // for ops to pivot on (see MOBILE_SALES_REFUND.md §audit log).
  private async relayRpcEnvelope<T>(
    action: string,
    params: unknown,
    options?: RequestOptions,
  ): Promise<{data: T; correlationId: string}> {
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

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({action, params, timeout: serverTimeoutSec}),
        signal: controller.signal,
      });
    } catch (netErr) {
      // fetch() itself rejected → network down / abort-timeout, no HTTP status.
      // Pure transport failure → unreachable (mirrors the refresh path's
      // status===undefined rule). (M-R1)
      clearTimeout(timer);
      this.reportReachable(false);
      throw netErr;
    }

    try {

      // The server ANSWERED (we have an HTTP status). Even a 401/4xx means the
      // cloud is up → reachable. Only gateway transport states (502/503/504,
      // below) and network-level throws (catch) count as unreachable. (M-R1)
      const transportFailure =
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504;
      this.reportReachable(!transportFailure);

      if (response.status === 401) {
        // The auth.refresh action itself is allowed to 401 — that means the
        // token genuinely can't be refreshed (revoked, server lost the
        // session). In that case we DO bounce. For any other action, try
        // a one-shot refresh-and-retry before wiping the session, so a
        // routine token expiry doesn't kick the user back to login mid-task.
        //
        // CRITICAL: parallel 401s (e.g. Dashboard's Promise.all on cold
        // start) must collapse onto ONE refresh round-trip. Without the
        // single-flight `refreshPromise`, racer A and racer B both call
        // `onRefreshCb()` — A wins, B reads the store mid-update and sees
        // a half-applied state, returns false, fires `handleUnauthorized`,
        // and wipes the session A just refreshed. That race is the actual
        // cause of "I get bounced back to login after a day even with
        // Keep Me Signed In ticked".
        const isRefresh = action === RELAY_ACTIONS.AUTH_REFRESH;
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
            // Retry the original call with the freshly-set bearer. The
            // __retried flag prevents infinite recursion if the new token
            // is also rejected.
            return this.relayRpcEnvelope<T>(action, params, {
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
        const isTransportFailure = transportFailure;
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
        // The relay edge answered (HTTP 200) but the upstream deployment did
        // not respond in time. For the §14.7 Q9 reachability signal this is a
        // transport-class miss (mirrors the refresh path's no-HTTP-status →
        // unreachable rule), so downgrade the earlier optimistic report. (M-R1)
        this.reportReachable(false);
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
      return {
        data: envelope.data as T,
        correlationId: envelope.correlation_id,
      };
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
