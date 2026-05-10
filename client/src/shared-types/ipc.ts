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

  LOCK_GET_STATE: 'lock:get-state',
  LOCK_SET_PIN: 'lock:set-pin',
  LOCK_VERIFY_PIN: 'lock:verify-pin',
  LOCK_CLEAR_PIN: 'lock:clear-pin',
  LOCK_NOW: 'lock:lock-now',
  LOCK_STATE_CHANGED: 'lock:state-changed',

  DIAGNOSTICS_GET_RECENT_LOGS: 'diagnostics:get-recent-logs',

  APP_VERSION: 'app:version',

  UPDATE_CHECK_NOW: 'update:check-now',
  UPDATE_OPEN_DOWNLOAD: 'update:open-download',
  UPDATE_INSTALL_NOW: 'update:install-now',
  UPDATE_STATUS_CHANGED: 'update:status-changed',
  UPDATE_MANUAL_FALLBACK: 'update:manual-fallback',

  PRINT_RECEIPT: 'print:receipt',
  PRINT_TEST: 'print:test',
  PRINT_ZREPORT: 'print:zreport',
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
  // null → use the OS default printer. Non-null is matched against
  // webContents.getPrintersAsync(); falls back to the default if missing.
  printerName: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  workspaceCode: '',
  relayUrl: 'https://api.aeris.team',
  autoLockMs: 5 * 60 * 1000, // 5 minutes
  lockEnabled: true,
  printerName: null,
};

// --- app lock ---------------------------------------------------------------

export interface AppLockState {
  initialized: boolean;
  isPinSet: boolean;
  locked: boolean;
  attempts: number;
  lockedOutUntilMs: number | null;
}

export interface SetPinResult {
  ok: boolean;
  message?: string;
}

export interface VerifyPinResult {
  ok: boolean;
  attemptsRemaining?: number;
  lockedOutUntilMs?: number | null;
}

// --- auto-update ------------------------------------------------------------

// Mirrors electron-updater's high-level lifecycle plus our manual-fallback
// state. Renderer surfaces the status as a non-blocking banner.
export type UpdateStatusKind =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'manual-fallback';

export interface UpdateStatus {
  kind: UpdateStatusKind;
  version?: string;
  // Percent 0..100 when downloading.
  progress?: number;
  // Human-readable error message (kind === 'error').
  message?: string;
  // GitHub release HTML URL — only set on `manual-fallback` so the
  // renderer can shell.openExternal a Download button.
  htmlUrl?: string;
}

export interface CheckNowResult {
  ok: boolean;
  message?: string;
}

// --- printing ---------------------------------------------------------------

export type PrintReceiptResult =
  | { ok: true }
  | { ok: false; message: string };
