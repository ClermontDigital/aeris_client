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
  // M-R8: connection-mode switch → wipe the session so the cashier re-auths
  // against the new target (the relay Sanctum token is not valid on the on-prem
  // ERP and vice-versa). Surfaces the §21 Q5 "Switching to in-store mode" copy.
  AUTH_MODE_SWITCH: 'auth:mode-switch',
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

  // DR M3-E (NAS warm-failover, Electron parity). The main process owns the
  // failover orchestration (cloud-reachability hysteresis, NAS health probe,
  // dr.routing poll, the routing cascade + auto-swap). The renderer mirrors a
  // read-only snapshot of that state via DR_GET_STATE + DR_STATE_CHANGED so the
  // ModeIndicator chip + failover banner reflect cloud/local/switching/offline.
  DR_GET_STATE: 'dr:get-state',
  DR_STATE_CHANGED: 'dr:state-changed',
  // Renderer → main mid-transaction signal (§22.5 Q1 rule 1). The renderer
  // reports {cartItemCount, activeScreen} on cart/route changes so the main
  // orchestrator NEVER auto-switches mid-sale. createSale/refundSale in-flight
  // is tracked in main directly (relayBridge dispatch).
  DR_REPORT_ACTIVITY: 'dr:report-activity',
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
  // DR M3-E fail-closed: relayBridge refuses to dispatch to a NAS whose cert
  // identity is a known mismatch (defence-in-depth ahead of SPKI pinning).
  | 'CERT_MISMATCH'
  | 'UNKNOWN';

// --- auth -------------------------------------------------------------------

export interface AuthUserSnapshot {
  id: number;
  email: string;
  name?: string;
  role?: string;
}

export type AuthErrorKind =
  | 'expired'
  | 'invalid'
  | 'network'
  | 'unknown'
  // M-R8 / §21 Q5: shown after a connection-mode switch wiped the session.
  | 'mode-switch';

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

// Cloud (relay, via the marketplace gateway) vs Direct (peer-to-peer over the
// LAN to the on-prem/NAS deployment). v2 shipped relay-only; the DR
// Warm-Failover project (docs/PROJECT_DR_NAS_WARM_FAILOVER.md §3.1/§8) adds
// Direct mode so an Electron till can fail over to the NAS during an outage,
// mirroring the mobile client's existing two-target model.
export type ConnectionMode = 'relay' | 'direct';

export interface AppSettings {
  workspaceCode: string;
  relayUrl: string;
  // Direct/LAN target — the on-prem/NAS deployment base URL (e.g.
  // https://aeris.shop.local:8822). Empty until configured. Used only when
  // connectionMode === 'direct'. Net-new in the DR project (§8).
  baseUrl: string;
  // Which transport relay:call routes through. Defaults to 'relay' (cloud).
  connectionMode: ConnectionMode;
  // DR M3-E master flag (default OFF, mirroring mobile's
  // settingsStore.autoFailoverEnabled). The SINGLE gate that converts the
  // routing cascade's outage branch from "manual switch only" (M2 behaviour)
  // into an automatic cloud→NAS swap (and NAS→cloud failback). Flag OFF ⇒ the
  // orchestrator never auto-switches and never caches credentials — the app
  // behaves byte-identically to today's M2 manual path. Per-deployment enable
  // is hard-gated behind the §6 proof-gate; this build ships DARK.
  autoFailoverEnabled: boolean;
  autoLockMs: number;
  lockEnabled: boolean;
  // null → use the OS default printer. Non-null is matched against
  // webContents.getPrintersAsync(); falls back to the default if missing.
  printerName: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  workspaceCode: '',
  relayUrl: 'https://api.aeris.team',
  // Empty by default — Direct mode is opt-in (DR failover / on-prem). A blank
  // baseUrl in relay mode is never read; in direct mode the UI requires it.
  baseUrl: '',
  connectionMode: 'relay',
  // DR M3-E: auto-failover OFF by default everywhere (§3 guardrail 2). Ships
  // dark; turning it on is a separate, proof-gated event.
  autoFailoverEnabled: false,
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

// --- DR (NAS warm-failover, M3-E) -------------------------------------------

// The authority the till is currently selling against, mirroring mobile's
// RoutingMode (§19.3 indicator). Derived in main from the live routing cascade.
//   cloud     — relay/cloud is the writer (normal).
//   local     — Direct/LAN against the NAS.
//   switching — a mode-switch (clear-session + re-auth) is in flight.
//   offline   — degraded: neither cloud nor a usable NAS reachable (fail-closed).
export type DrMode = 'cloud' | 'local' | 'switching' | 'offline';

// Read-only snapshot the main process broadcasts to the renderer so the
// ModeIndicator + failover banner can reflect failover state WITHOUT the
// renderer ever driving the orchestration (which is main-owned, like the
// bearer). Everything here is advisory UI state.
export interface DrState {
  // The resolved authority chip state.
  mode: DrMode;
  // Whether the deployment exposes a DR routing surface at all (dr.routing
  // returned a payload with dr_enabled=true). false ⇒ no DR for this client.
  drEnabled: boolean;
  // The master flag's current value (mirror of settings.autoFailoverEnabled),
  // so the banner can pick auto-mode copy vs the M2 manual-prompt copy.
  autoFailoverEnabled: boolean;
  // True while the cascade wants the cashier to confirm an outage failover
  // (flag OFF + cloud unreachable + NAS usable) — the M2 manual prompt.
  promptFailover: boolean;
  // Live cloud reachability per the hysteresis signal (null = unknown).
  cloudReachable: boolean | null;
  // Live NAS probe verdict for the cached LAN target (null = no target/unknown).
  nasReachable: boolean | null;
  // True when the cached NAS endpoint failed the cert identity check
  // (fail-closed — the NAS is never a valid target while this is true).
  nasCertMismatch: boolean;
}

// Renderer-reported transaction activity for the mid-transaction defer (rule 1).
export interface DrActivityReport {
  cartItemCount: number;
  // The current route/screen name ('Checkout' is the load-bearing one).
  activeScreen: string | null;
}

export const DEFAULT_DR_STATE: DrState = {
  mode: 'cloud',
  drEnabled: false,
  autoFailoverEnabled: false,
  promptFailover: false,
  cloudReachable: null,
  nasReachable: null,
  nasCertMismatch: false,
};
