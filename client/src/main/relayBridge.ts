import { RelayClient, RelayError, RELAY_ACTIONS } from '@aeris/shared';
import {
  IPC_CHANNELS,
  PAYLOAD_SIZE_BUDGET_BYTES,
  RelayCallOptions,
  RelayCallResult,
  RelayErrorCode,
} from '../shared-types/ipc';
import { settingsStore } from './settingsStore';
import { tokenStore } from './tokenStore';
import { logger } from './logger';
import { safeHandle } from './senderGuard';
import { DirectClient } from './directClient';
import { isLocalUrlSafeForCache } from './drUrlValidator';
import { cloudReachability } from './cloudReachability';
import { txnActivity } from './txnActivity';
import { drState } from './drState';

// relayBridge owns the transport client(s) and is the one place in the app
// that knows the bearer token. The renderer issues calls via the
// `relay:call` IPC and never sees the token.
//
// DR Warm-Failover (§3.1/§8) added a Direct/LAN transport alongside the
// RelayClient: when settings.connectionMode === 'direct' the same dispatch
// routes to the DirectClient (peer-to-peer over the LAN to the NAS), which
// keeps the till selling during a true WAN outage. The bearer is kept in sync
// across both transports so a mode flip preserves the token confinement.
//
// Auth lifecycle:
// - On startup: applies settings + persisted token to both clients.
// - Wires onUnauthorized -> authManager.handleUnauthorized() so a 401
//   anywhere routes through the same logout path.
// - Network/timeout errors translate to RelayCallResult.code = 'NETWORK' |
//   'TIMEOUT' so the renderer can show a transient banner WITHOUT logging
//   out (peer review revision #6).

let client: RelayClient | null = null;
let direct: DirectClient | null = null;
let onUnauthorizedCb: (() => void) | null = null;

export function getRelayClient(): RelayClient {
  if (!client) {
    client = new RelayClient();
  }
  return client;
}

export function getDirectClient(): DirectClient {
  if (!direct) {
    direct = new DirectClient();
  }
  return direct;
}

// Whether the app is currently operating in Direct/LAN mode (vs cloud relay).
export function isDirectMode(): boolean {
  return settingsStore.get().connectionMode === 'direct';
}

export async function initRelayBridge(): Promise<void> {
  const c = getRelayClient();
  const d = getDirectClient();
  let settings = settingsStore.get();

  // COLD-START DR gate (DR §15-2 / §14.7) — the second leg of the validator.
  // settingsStore.set() validates the Direct baseUrl at WRITE-time and on a
  // mode switch, but NOT here on READ at cold start. A malicious/legacy bad
  // baseUrl already on disk + connectionMode==='direct' would otherwise be
  // configured onto the DirectClient and (once authManager applies the bearer)
  // ship the token to the attacker host on the next renderer action — no switch
  // happens, so the write-time gate never runs. Re-validate on read and, on
  // failure, FORCE a fallback to relay mode so the bearer is never applied to a
  // Direct client pointed at an unvalidated/bad host. Persist the fallback so
  // the renderer's settings UI reflects the safe state.
  let directBaseUrlRejected = false;
  if (settings.connectionMode === 'direct') {
    const baseUrl = (settings.baseUrl ?? '').trim();
    if (!isLocalUrlSafeForCache(baseUrl)) {
      directBaseUrlRejected = true;
      logger.warn(
        '[relayBridge] cold-start: persisted Direct baseUrl failed validation; ' +
          'forcing fallback to relay mode (bearer will NOT be applied to the ' +
          'Direct client)',
      );
      // settingsStore.set with only connectionMode='relay' bypasses the
      // Direct-baseUrl gate (we're leaving Direct, not entering it) and emits
      // the onChange so the relay/direct configure() below stay consistent.
      settings = settingsStore.set({ connectionMode: 'relay' });
    }
  }

  c.configure({
    relayUrl: settings.relayUrl,
    workspaceCode: settings.workspaceCode,
  });
  // When we rejected the persisted Direct baseUrl, do NOT configure the Direct
  // client with that bad host (nor seed the bearer onto it below). It stays
  // unconfigured + tokenless until the user re-enters Direct mode through the
  // write-time gate, which re-runs validation and the onChange listener seeds
  // a known-good target. We're in relay mode now, so dispatch uses the relay
  // client regardless.
  if (!directBaseUrlRejected) {
    d.configure({ baseUrl: settings.baseUrl });
  }

  const token = await tokenStore.getToken();
  c.setAuthToken(token);
  if (!directBaseUrlRejected) {
    d.setAuthToken(token);
  }

  const onUnauth = () => {
    if (onUnauthorizedCb) {
      try {
        onUnauthorizedCb();
      } catch (e) {
        logger.warn('[relayBridge] onUnauthorized callback threw', e);
      }
    }
  };
  c.setOnUnauthorized(onUnauth);
  d.setOnUnauthorized(onUnauth);

  // DR M3-A/M3-E: drive the cloud-reachability hysteresis off the RelayClient's
  // per-response hook. EVERY relay round-trip (any renderer action, the
  // dr.routing poll, refresh) reports its transport outcome here; after 3
  // consecutive transport failures cloudReachability flips unreachable, which is
  // the producer the failover cascade consumes. Only the cloud transport feeds
  // this signal — Direct/LAN responses say nothing about cloud reachability.
  c.setOnResponse((reachable) => cloudReachability.report(reachable));

  // Re-apply settings as they change so the renderer's settings UI takes
  // effect immediately. The Direct baseUrl + the relay URL/workspace are
  // both kept current so a connection-mode flip routes correctly.
  settingsStore.onChange((next) => {
    c.configure({
      relayUrl: next.relayUrl,
      workspaceCode: next.workspaceCode,
    });
    d.configure({ baseUrl: next.baseUrl });
  });
}

export function setOnUnauthorized(cb: (() => void) | null): void {
  onUnauthorizedCb = cb;
}

// DR M3-0 — fetch the deployment's cached DR routing state over the relay.
// REUSES the shared RelayClient.getDrRouting() (which maps a flag-off / non-DR
// deployment's 404 / NOT_FOUND to null → callers fall back to the M2 manual
// path, never error). ALWAYS uses the relay/cloud transport even in Direct
// mode: dr.routing is a route-proxied gateway action served by the deployment,
// not a Direct/LAN REST endpoint (mirrors mobile's relay-only ApiClient facade).
export function getDrRouting(): ReturnType<RelayClient['getDrRouting']> {
  return getRelayClient().getDrRouting();
}

// DR M3 — best-effort DR presence beat over the relay (fire-and-forget; any
// non-2xx is a silent no-op inside the shared method). Relay-only, same reason.
export function reportDrPresence(beat: {
  device_id: string;
  mode: 'cloud' | 'local';
}): Promise<boolean> {
  return getRelayClient().reportDrPresence(beat);
}

// M-R9: set (or clear) the bearer on BOTH transports in one call. Previously
// authManager only touched getRelayClient(); the per-call sync at the dispatch
// site (`d.setAuthToken(getRelayClient().getAuthToken())`) covered the 401
// path but NOT fresh-login (DirectClient stayed null until the first call) or
// rapid mode flips. Routing every authManager token mutation through here keeps
// the relay + direct clients in lockstep so a mode switch never dispatches with
// a stale or absent token.
export function applyAuthToken(token: string | null): void {
  getRelayClient().setAuthToken(token);
  getDirectClient().setAuthToken(token);
}

function classifyError(err: unknown): {
  code: RelayErrorCode;
  message: string;
  correlationId?: string;
} {
  if (err instanceof RelayError) {
    const correlationId = err.correlationId ?? undefined;
    // Map RelayError.code (TIMEOUT | NETWORK | UNKNOWN | server-defined)
    // onto our IPC RelayErrorCode so the renderer banner tone is correct
    // — anything not in the known set falls through to SERVER.
    let code: RelayErrorCode;
    switch (err.code) {
      case 'TIMEOUT':
        code = 'TIMEOUT';
        break;
      case 'NETWORK':
        code = 'NETWORK';
        break;
      case 'UNKNOWN':
        code = 'UNKNOWN';
        break;
      default:
        code = 'SERVER';
    }
    return { code, message: err.message, correlationId };
  }
  const e = err as Error & { status?: number; name?: string };
  if (e?.status === 401) {
    return { code: 'UNAUTHORIZED', message: 'Authentication expired.' };
  }
  if (e?.name === 'AbortError') {
    return { code: 'TIMEOUT', message: 'Request timed out.' };
  }
  if (e?.status && e.status >= 500) {
    return { code: 'SERVER', message: e.message || 'Server error.' };
  }
  if (e?.status && e.status >= 400) {
    return { code: 'BAD_REQUEST', message: e.message || 'Bad request.' };
  }
  // No HTTP status -> network failure (DNS, offline, ECONNREFUSED, etc.)
  if (!e?.status) {
    return { code: 'NETWORK', message: e?.message || 'Network error.' };
  }
  return { code: 'UNKNOWN', message: e?.message || 'Unknown error.' };
}

// Returns null for non-serialisable inputs so the caller can distinguish
// "params not JSON-serialisable" (BAD_REQUEST) from oversize.
// TODO(#L3): RelayClient.relayRpc is private and re-stringifies the body;
// double-stringify (~400 KB churn at the 200 KB ceiling) can only be
// avoided by widening the shared signature, which is out of scope here.
function payloadByteSize(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
  } catch {
    return null;
  }
}

// Closed allowlist for renderer-issued action names. Defends against the
// open marketplace_rpc.php server map by refusing anything we don't bind
// to a typed RelayClient method. Add new actions explicitly when wiring.
// auth.* flows must go through the dedicated auth:login / auth:logout IPC
// (authManager) so setState/persistSession/errorKind UX run; refusing them
// here stops a buggy renderer from minting Sanctum tokens via relay:call.
const BLOCKED_ACTIONS: ReadonlySet<string> = new Set<string>([
  RELAY_ACTIONS.AUTH_LOGIN,
  RELAY_ACTIONS.AUTH_BIOMETRIC,
  RELAY_ACTIONS.AUTH_LOGOUT,
  RELAY_ACTIONS.AUTH_REFRESH,
]);
const ALLOWED_ACTIONS: ReadonlySet<string> = new Set<string>(
  Object.values(RELAY_ACTIONS).filter((a) => !BLOCKED_ACTIONS.has(a)),
);

export function registerRelayBridgeIpc(): void {
  safeHandle(IPC_CHANNELS.RELAY_CALL, async (_event, ...args): Promise<RelayCallResult> => {
    const [action, params, options] = args as [unknown, unknown, RelayCallOptions | undefined];
    if (typeof action !== 'string' || action.length === 0) {
      return { ok: false, code: 'BAD_REQUEST', message: 'action must be a non-empty string' };
    }
    // Reject unknown actions before they reach the relay (#H4): the server
    // marketplace_rpc.php map is open, so we close it here.
    if (!ALLOWED_ACTIONS.has(action)) {
      return { ok: false, code: 'BAD_REQUEST', message: 'unknown action' };
    }
    const size = payloadByteSize(params);
    if (size === null) {
      return {
        ok: false,
        code: 'BAD_REQUEST',
        message: 'params not JSON-serialisable',
      };
    }
    if (size > PAYLOAD_SIZE_BUDGET_BYTES) {
      return {
        ok: false,
        code: 'PAYLOAD_TOO_LARGE',
        message: `payload ${size} bytes exceeds budget ${PAYLOAD_SIZE_BUDGET_BYTES}`,
      };
    }

    // DR M3-E fail-closed (parity with mobile ApiClient.active): in Direct mode
    // NEVER send the bearer to a NAS whose cert identity is a known MISMATCH.
    // The auto-failover cascade's nasUsable gate already refuses to auto-switch
    // to a mismatch'd host; this closes the bypass paths (manual switch /
    // deep-link) at the dispatch boundary too. Currently inert — certTrust is
    // only 'unverified'/'unknown' until SPKI pinning lands (§5) — defence-in-
    // depth ahead of that.
    if (isDirectMode() && drState.get().certTrust === 'mismatch') {
      return {
        ok: false,
        code: 'CERT_MISMATCH',
        message: 'on-prem server identity mismatch — refusing to connect',
      };
    }

    // DR M3-E rule 1: bracket in-flight writes so the failover orchestrator
    // never auto-switches mid-transaction (§22.5 Q1). The renderer also reports
    // cart/screen, but a write in flight is the hard gate.
    //
    // Three buckets — mirrors mobile's producer set (1.4.12):
    //   • sale/refund      → beginSale          (money-move)
    //   • customer writes  → beginAccountWrite  (account-side mutation)
    //   • product writes / stock adjust → beginSettlementOrPrint (catalog/inv)
    // Catalog edits + stock adjusts are bucketed with print because they
    // share the "write that mustn't be interrupted" property and the mobile
    // setter name happens to be the closest parity slot.
    const isSaleWrite =
      action === RELAY_ACTIONS.SALE_CREATE || action === RELAY_ACTIONS.SALES_REFUND;
    const isAccountWrite =
      action === RELAY_ACTIONS.CUSTOMERS_CREATE ||
      action === RELAY_ACTIONS.CUSTOMERS_UPDATE ||
      action === RELAY_ACTIONS.CUSTOMERS_DELETE;
    const isSettlementOrPrintWrite =
      action === RELAY_ACTIONS.PRODUCTS_CREATE ||
      action === RELAY_ACTIONS.PRODUCTS_UPDATE ||
      action === RELAY_ACTIONS.INVENTORY_ADJUST_STOCK;
    if (isSaleWrite) txnActivity.beginSale();
    if (isAccountWrite) txnActivity.beginAccountWrite();
    if (isSettlementOrPrintWrite) txnActivity.beginSettlementOrPrint();
    try {
      // Route by connection mode (§3.1). Direct mode talks straight to the
      // LAN deployment; relay mode goes through the gateway. The bearer is
      // synced onto whichever client serves the call so token confinement
      // holds across a mode flip without authManager needing to know about
      // both transports.
      let data: unknown;
      if (isDirectMode()) {
        const d = getDirectClient();
        d.setAuthToken(getRelayClient().getAuthToken());
        data = await callDirectDispatch(d, action, params, options);
      } else {
        data = await callDispatch(getRelayClient(), action, params, options);
      }
      return { ok: true, data };
    } catch (err) {
      const classified = classifyError(err);
      // Don't log the relay's full error message — server-echoed PII
      // may be in there. Action + code + correlationId is enough for
      // support to triage; the message rides on to the renderer.
      logger.warn('[relayBridge] call failed', {
        action,
        code: classified.code,
        correlationId: classified.correlationId,
      });
      return { ok: false, ...classified };
    } finally {
      if (isSaleWrite) txnActivity.endSale();
      if (isAccountWrite) txnActivity.endAccountWrite();
      if (isSettlementOrPrintWrite) txnActivity.endSettlementOrPrint();
    }
  });
}

// Route well-known actions through RelayClient's typed methods so the
// renderer receives the unwrapped + normalized payload. The previous
// pass-through to relayRpc returned raw envelopes like
// `{data: [...], meta: {...}}` — screens expecting normalized arrays
// stayed stuck on "Loading…". The IPC handler enforces ALLOWED_ACTIONS
// before calling this, so the default branch is unreachable for valid
// inputs and exists only as a defensive last-resort that mirrors the
// allowlist policy (#H4).
async function callDispatch(
  c: RelayClient,
  action: string,
  params: unknown,
  options?: RelayCallOptions,
): Promise<unknown> {
  const p = (params ?? {}) as Record<string, unknown>;
  switch (action) {
    case RELAY_ACTIONS.DASHBOARD_SUMMARY:
      return c.getDailySummary(
        p.date as string | undefined,
        p.location_id as number | undefined,
      );

    case RELAY_ACTIONS.PRODUCTS_LIST:
      return c.listProducts(
        (p.page as number | undefined) ?? 1,
        (p.per_page as number | undefined) ?? (p.perPage as number | undefined) ?? 20,
      );
    case RELAY_ACTIONS.PRODUCTS_SEARCH:
      return c.searchProducts(
        (p.query as string) ?? (p.q as string) ?? '',
        (p.page as number | undefined) ?? 1,
        (p.per_page as number | undefined) ?? (p.perPage as number | undefined) ?? 20,
      );
    case RELAY_ACTIONS.PRODUCTS_DETAIL:
      return c.getProductDetail((p.id as number) ?? (p.product_id as number));
    case RELAY_ACTIONS.PRODUCTS_BARCODE:
      return c.getProductByBarcode(p.barcode as string);
    case RELAY_ACTIONS.PRODUCTS_CATEGORIES:
      return c.getCategories();
    case RELAY_ACTIONS.INVENTORY_STOCK:
      return c.getStock(
        (p.product_id as number) ?? (p.id as number),
        p.location_id as number | undefined,
      );

    case RELAY_ACTIONS.CUSTOMERS_LIST:
      return c.listCustomers(
        (p.page as number | undefined) ?? 1,
        (p.per_page as number | undefined) ?? (p.perPage as number | undefined) ?? 20,
      );
    case RELAY_ACTIONS.CUSTOMERS_SEARCH:
      return c.searchCustomers(
        (p.query as string) ?? (p.q as string) ?? '',
        (p.page as number | undefined) ?? 1,
      );
    case RELAY_ACTIONS.CUSTOMERS_DETAIL:
      return c.getCustomerDetail((p.id as number) ?? (p.customer_id as number));

    case RELAY_ACTIONS.TRANSACTIONS_LIST:
      return c.getTransactions({
        page: p.page as number | undefined,
        per_page:
          (p.per_page as number | undefined) ?? (p.perPage as number | undefined),
        date_from: (p.date_from as string | undefined) ?? (p.from_date as string | undefined),
        date_to: (p.date_to as string | undefined) ?? (p.to_date as string | undefined),
      });
    case RELAY_ACTIONS.TRANSACTIONS_DETAIL:
      return c.getTransactionDetail((p.id as number) ?? (p.sale_id as number));
    case RELAY_ACTIONS.TRANSACTIONS_RECEIPT:
      return c.getReceipt((p.id as number) ?? (p.sale_id as number));

    case RELAY_ACTIONS.POS_PAYMENT_METHODS:
      return c.getPaymentMethods();

    case RELAY_ACTIONS.SALE_CREATE:
      // Route through the typed method so cents→dollars conversion +
      // idempotency-key retry stay server-of-record. Renderer passes
      // a cents-shape payload; never duplicate the dollar conversion.
      return c.createSale(
        p as unknown as Parameters<RelayClient['createSale']>[0],
      );

    case RELAY_ACTIONS.CUSTOMERS_CREATE:
      return c.createCustomer(
        p as unknown as Parameters<RelayClient['createCustomer']>[0],
      );
    case RELAY_ACTIONS.CUSTOMERS_UPDATE: {
      const id = (p.id as number) ?? (p.customer_id as number);
      const { id: _omitId, customer_id: _omitCid, ...patch } = p;
      return c.updateCustomer(
        id,
        patch as unknown as Parameters<RelayClient['updateCustomer']>[1],
      );
    }
    case RELAY_ACTIONS.CUSTOMERS_DELETE:
      return c.deleteCustomer((p.id as number) ?? (p.customer_id as number));

    case RELAY_ACTIONS.PRODUCTS_CREATE:
      return c.createProduct(
        p as unknown as Parameters<RelayClient['createProduct']>[0],
      );
    case RELAY_ACTIONS.PRODUCTS_UPDATE: {
      const id = (p.id as number) ?? (p.product_id as number);
      const { id: _omitId, product_id: _omitPid, ...patch } = p;
      return c.updateProduct(
        id,
        patch as unknown as Parameters<RelayClient['updateProduct']>[1],
      );
    }

    case RELAY_ACTIONS.INVENTORY_ADJUST_STOCK:
      return c.adjustStock(
        p as unknown as Parameters<RelayClient['adjustStock']>[0],
      );

    case RELAY_ACTIONS.SALES_DAILY_SUMMARY:
      return c.getDailyZReport(
        p.date as string | undefined,
        p.location_id as number | undefined,
      );

    default: {
      // Defensive fallback — IPC handler should already have rejected
      // anything not in ALLOWED_ACTIONS. Keep this branch only for
      // RELAY_ACTIONS entries that haven't yet got a typed binding.
      const anyClient = c as unknown as {
        relayRpc: (
          a: string,
          pp: unknown,
          opts?: { idempotencyKey?: string },
        ) => Promise<unknown>;
      };
      return anyClient.relayRpc(action, p, options);
    }
  }
}

// Direct-mode counterpart of callDispatch (§3.1). The DirectClient mirrors the
// RelayClient method surface, so the routing is identical; only the transport
// differs (LAN REST vs gateway RPC). Kept as a separate switch (rather than a
// shared structural type) so each transport's available bindings stay explicit
// and a NAS that lacks an action surfaces a clean error rather than a silent
// wrong call. Actions not yet bound here throw 'unsupported in direct mode'
// — there is no relayRpc fallback on the LAN path.
async function callDirectDispatch(
  d: DirectClient,
  action: string,
  params: unknown,
  _options?: RelayCallOptions,
): Promise<unknown> {
  const p = (params ?? {}) as Record<string, unknown>;
  switch (action) {
    case RELAY_ACTIONS.DASHBOARD_SUMMARY:
      return d.getDailySummary(
        p.date as string | undefined,
        p.location_id as number | undefined,
      );
    case RELAY_ACTIONS.PRODUCTS_LIST:
      return d.listProducts(
        (p.page as number | undefined) ?? 1,
        (p.per_page as number | undefined) ?? (p.perPage as number | undefined) ?? 20,
      );
    case RELAY_ACTIONS.PRODUCTS_SEARCH:
      return d.searchProducts(
        (p.query as string) ?? (p.q as string) ?? '',
        (p.page as number | undefined) ?? 1,
        (p.per_page as number | undefined) ?? (p.perPage as number | undefined) ?? 20,
      );
    case RELAY_ACTIONS.PRODUCTS_DETAIL:
      return d.getProductDetail((p.id as number) ?? (p.product_id as number));
    case RELAY_ACTIONS.PRODUCTS_BARCODE:
      return d.getProductByBarcode(p.barcode as string);
    case RELAY_ACTIONS.PRODUCTS_CATEGORIES:
      return d.getCategories();
    case RELAY_ACTIONS.INVENTORY_STOCK:
      return d.getStock(
        (p.product_id as number) ?? (p.id as number),
        p.location_id as number | undefined,
      );
    case RELAY_ACTIONS.CUSTOMERS_LIST:
      return d.listCustomers(
        (p.page as number | undefined) ?? 1,
        (p.per_page as number | undefined) ?? (p.perPage as number | undefined) ?? 20,
      );
    case RELAY_ACTIONS.CUSTOMERS_SEARCH:
      return d.searchCustomers(
        (p.query as string) ?? (p.q as string) ?? '',
        (p.page as number | undefined) ?? 1,
      );
    case RELAY_ACTIONS.CUSTOMERS_DETAIL:
      return d.getCustomerDetail((p.id as number) ?? (p.customer_id as number));
    case RELAY_ACTIONS.TRANSACTIONS_LIST:
      return d.getTransactions({
        page: p.page as number | undefined,
        per_page:
          (p.per_page as number | undefined) ?? (p.perPage as number | undefined),
        date_from: (p.date_from as string | undefined) ?? (p.from_date as string | undefined),
        date_to: (p.date_to as string | undefined) ?? (p.to_date as string | undefined),
      });
    case RELAY_ACTIONS.TRANSACTIONS_DETAIL:
      return d.getTransactionDetail((p.id as number) ?? (p.sale_id as number));
    case RELAY_ACTIONS.TRANSACTIONS_RECEIPT:
      return d.getReceipt((p.id as number) ?? (p.sale_id as number));
    case RELAY_ACTIONS.POS_PAYMENT_METHODS:
      return d.getPaymentMethods();
    case RELAY_ACTIONS.SALE_CREATE:
      return d.createSale(
        p as unknown as Parameters<DirectClient['createSale']>[0],
      );
    case RELAY_ACTIONS.CUSTOMERS_CREATE:
      return d.createCustomer(
        p as unknown as Parameters<DirectClient['createCustomer']>[0],
      );
    case RELAY_ACTIONS.CUSTOMERS_UPDATE: {
      const id = (p.id as number) ?? (p.customer_id as number);
      const { id: _omitId, customer_id: _omitCid, ...patch } = p;
      return d.updateCustomer(
        id,
        patch as unknown as Parameters<DirectClient['updateCustomer']>[1],
      );
    }
    case RELAY_ACTIONS.CUSTOMERS_DELETE:
      return d.deleteCustomer((p.id as number) ?? (p.customer_id as number));
    case RELAY_ACTIONS.PRODUCTS_CREATE:
      return d.createProduct(
        p as unknown as Parameters<DirectClient['createProduct']>[0],
      );
    case RELAY_ACTIONS.PRODUCTS_UPDATE: {
      const id = (p.id as number) ?? (p.product_id as number);
      const { id: _omitId, product_id: _omitPid, ...patch } = p;
      return d.updateProduct(
        id,
        patch as unknown as Parameters<DirectClient['updateProduct']>[1],
      );
    }
    case RELAY_ACTIONS.INVENTORY_ADJUST_STOCK:
      return d.adjustStock(
        p as unknown as Parameters<DirectClient['adjustStock']>[0],
      );
    // NOTE: sales.daily-summary (the full Z-report) is deliberately NOT bound
    // in Direct mode — the Z-report stays cloud-only by construction (§14.7
    // Q10), matching mobile's DirectClient (which has no getDailyZReport). It
    // falls through to the default branch below and surfaces a clean 400
    // rather than serving a day-close report off the NAS during a failover.
    // The renderer hides the Z-report screen in Direct mode (see Sidebar /
    // DailyZReportScreen); the in-store running total is dashboard.summary,
    // labelled "In-store totals only".
    default: {
      const err = new Error(`action '${action}' is unsupported in direct mode`);
      (err as Error & { status?: number }).status = 400;
      throw err;
    }
  }
}
