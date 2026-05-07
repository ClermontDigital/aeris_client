import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { RelayClient, RelayError } from '@aeris/shared';
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
    if (err.code === 'TIMEOUT') {
      return { code: 'TIMEOUT', message: err.message, correlationId };
    }
    return {
      code: 'SERVER',
      message: err.message,
      correlationId,
    };
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

function payloadByteSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
  } catch {
    // Non-serialisable inputs are rejected as bad requests.
    return Number.POSITIVE_INFINITY;
  }
}

export function registerRelayBridgeIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.RELAY_CALL,
    async (
      _event: IpcMainInvokeEvent,
      action: unknown,
      params: unknown,
      options?: RelayCallOptions,
    ): Promise<RelayCallResult> => {
      if (typeof action !== 'string' || action.length === 0) {
        return { ok: false, code: 'BAD_REQUEST', message: 'action must be a non-empty string' };
      }
      const size = payloadByteSize(params);
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
        logger.warn('[relayBridge] call failed', { action, ...classified });
        return { ok: false, ...classified };
      }
    },
  );
}

// Route well-known actions through RelayClient's typed methods so the
// renderer receives the unwrapped + normalized payload. The previous
// pass-through to relayRpc returned raw envelopes like
// `{data: [...], meta: {...}}` — screens expecting normalized arrays
// stayed stuck on "Loading…". Unknown actions still fall through to the
// raw relayRpc so future actions can be added without changing this
// file before the typed surface catches up.
async function callDispatch(
  c: RelayClient,
  action: string,
  params: unknown,
  options?: RelayCallOptions,
): Promise<unknown> {
  const p = (params ?? {}) as Record<string, unknown>;
  switch (action) {
    case 'dashboard.summary':
      return c.getDailySummary(p.location_id as number | undefined);

    case 'products.list':
      return c.listProducts(
        (p.page as number | undefined) ?? 1,
        (p.per_page as number | undefined) ?? (p.perPage as number | undefined) ?? 20,
      );
    case 'products.search':
      return c.searchProducts(
        (p.query as string) ?? (p.q as string) ?? '',
        (p.page as number | undefined) ?? 1,
        (p.per_page as number | undefined) ?? (p.perPage as number | undefined) ?? 20,
      );
    case 'products.detail':
      return c.getProductDetail((p.id as number) ?? (p.product_id as number));
    case 'products.barcode':
      return c.getProductByBarcode(p.barcode as string);
    case 'products.categories':
      return c.getCategories();
    case 'inventory.stock':
      return c.getStock(
        (p.product_id as number) ?? (p.id as number),
        p.location_id as number | undefined,
      );

    case 'customers.list':
      return c.listCustomers(
        (p.page as number | undefined) ?? 1,
        (p.per_page as number | undefined) ?? (p.perPage as number | undefined) ?? 20,
      );
    case 'customers.search':
      return c.searchCustomers(
        (p.query as string) ?? (p.q as string) ?? '',
        (p.page as number | undefined) ?? 1,
        (p.per_page as number | undefined) ?? (p.perPage as number | undefined) ?? 20,
      );
    case 'customers.detail':
      return c.getCustomerDetail((p.id as number) ?? (p.customer_id as number));

    case 'transactions.list':
      return c.getTransactions({
        page: p.page as number | undefined,
        per_page:
          (p.per_page as number | undefined) ?? (p.perPage as number | undefined),
        from_date: p.from_date as string | undefined,
        to_date: p.to_date as string | undefined,
        status: p.status as string | undefined,
      });
    case 'transactions.detail':
      return c.getTransactionDetail((p.id as number) ?? (p.sale_id as number));
    case 'transactions.receipt':
      return c.getReceipt((p.id as number) ?? (p.sale_id as number));

    case 'pos.payment-methods':
      return c.getPaymentMethods();

    default: {
      // Catch-all for actions not yet bound to a typed method. Renderer
      // takes the raw envelope data shape and normalizes inline.
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
