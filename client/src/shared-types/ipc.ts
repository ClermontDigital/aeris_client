// Typed IPC channel definitions for window.aeris bridge.
// Channels are namespaced "domain:verb" (relay:call, auth:login, etc.).
// Per-call payload size budget is documented in PAYLOAD_SIZE_BUDGET_BYTES;
// payloads exceeding this are rejected at the main-process IPC entry to
// prevent the renderer from accidentally serialising huge blobs.

export const PAYLOAD_SIZE_BUDGET_BYTES = 200 * 1024; // 200 KB

export const IPC_CHANNELS = {
  RELAY_CALL: 'relay:call',

  AUTH_GET_STATE: 'auth:get-state',
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_STATE_CHANGED: 'auth:state-changed',

  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_CHANGED: 'settings:changed',

  APP_VERSION: 'app:version',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

// --- relay:call -------------------------------------------------------------

export interface RelayCallOptions {
  idempotencyKey?: string;
}

export type RelayCallResult<T = unknown> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: RelayErrorCode;
      message: string;
      correlationId?: string;
    };

// Distinct codes so the renderer can differentiate "session is dead" from
// "transient transport error" — only UNAUTHORIZED triggers a logout.
export type RelayErrorCode =
  | 'UNAUTHORIZED'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'PAYLOAD_TOO_LARGE'
  | 'BAD_REQUEST'
  | 'SERVER'
  | 'UNKNOWN';

// --- auth -------------------------------------------------------------------

export interface AuthUserSnapshot {
  id: number;
  email: string;
  name?: string;
  role?: string;
}

export type AuthErrorKind = 'expired' | 'invalid' | 'network' | 'unknown';

export interface AuthState {
  initialized: boolean;
  isAuthenticated: boolean;
  user: AuthUserSnapshot | null;
  expiresAt: string | null;
  workspaceCode: string;
  // Last error from a login/restore attempt — null when clean.
  // 'expired' is set when a 401 wiped the session mid-flight.
  errorKind: AuthErrorKind | null;
}

export interface LoginRequest {
  workspaceCode: string;
  email: string;
  password: string;
}

// --- settings ---------------------------------------------------------------

export interface AppSettings {
  workspaceCode: string;
  relayUrl: string;
  autoLockMs: number;
  lockEnabled: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  workspaceCode: '',
  relayUrl: 'https://api.aeris.team',
  autoLockMs: 5 * 60 * 1000, // 5 minutes
  lockEnabled: true,
};
