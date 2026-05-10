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

// relayBridge owns a single RelayClient and is the one place in the app
// that knows the bearer token. The renderer issues calls via the
// `relay:call` IPC and never sees the token.
//
// Auth lifecycle:
// - On startup: applies settings + persisted token to the client.
// - Wires onUnauthorized -> authManager.handleUnauthorized() so a 401
//   anywhere routes through the same logout path.
// - Network/timeout errors translate to RelayCallResult.code = 'NETWORK' |
//   'TIMEOUT' so the renderer can show a transient banner WITHOUT logging
//   out (peer review revision #6).

let client: RelayClient | null = null;
let onUnauthorizedCb: (() => void) | null = null;

export function getRelayClient(): RelayClient {
  if (!client) {
    client = new RelayClient();
  }
  return client;
}

export async function initRelayBridge(): Promise<void> {
  const c = getRelayClient();
  const settings = settingsStore.get();
  c.configure({
    relayUrl: settings.relayUrl,
    workspaceCode: settings.workspaceCode,
  });

  const token = await tokenStore.getToken();
  c.setAuthToken(token);

  c.setOnUnauthorized(() => {
    if (onUnauthorizedCb) {
      try {
        onUnauthorizedCb();
      } catch (e) {
        logger.warn('[relayBridge] onUnauthorized callback threw', e);
      }
    }
  });

  // Re-apply settings as they change so the renderer's settings UI takes
  // effect immediately.
  settingsStore.onChange((next) => {
    c.configure({
      relayUrl: next.relayUrl,
      workspaceCode: next.workspaceCode,
    });
  });
}

export function setOnUnauthorized(cb: (() => void) | null): void {
  onUnauthorizedCb = cb;
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

    const c = getRelayClient();
    try {
      const data = await callDispatch(c, action, params, options);
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
