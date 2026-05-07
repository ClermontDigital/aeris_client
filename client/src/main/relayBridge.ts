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

// The RelayClient exposes typed helpers for known actions, but the bridge
// is intentionally a thin pass-through so the renderer can call any
// action by name (mirrors mobile's pattern). For Phase 2 the client only
// needs auth + dashboard; Phase 3 will expand to dispatch by the action
// constants.
async function callDispatch(
  c: RelayClient,
  action: string,
  params: unknown,
  options?: RelayCallOptions,
): Promise<unknown> {
  // Use the private relayRpc by way of the public action methods where
  // possible. For the catch-all path we type-cast to access the protected
  // method — this is intentionally co-located with the bridge so the
  // unsafe access is contained.
  const anyClient = c as unknown as {
    relayRpc: (
      action: string,
      params: unknown,
      options?: { idempotencyKey?: string },
    ) => Promise<unknown>;
  };
  return anyClient.relayRpc(action, params ?? {}, options);
}
