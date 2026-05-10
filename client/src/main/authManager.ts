import { BrowserWindow } from 'electron';
import {
  AuthErrorKind,
  AuthState,
  AuthUserSnapshot,
  IPC_CHANNELS,
  LoginRequest,
} from '../shared-types/ipc';
import { settingsStore } from './settingsStore';
import { tokenStore } from './tokenStore';
import { getRelayClient, setOnUnauthorized } from './relayBridge';
import { logger } from './logger';
import { safeHandle } from './senderGuard';

// authManager is the single source of truth for auth state in main.
// Renderer mirrors this state via auth:get-state + auth:state-changed
// events. Login / logout flow through the relay client; tokens are
// persisted in tokenStore. 401s anywhere wipe the session.

let state: AuthState = {
  initialized: false,
  isAuthenticated: false,
  user: null,
  expiresAt: null,
  workspaceCode: '',
  errorKind: null,
};

const subscribers = new Set<BrowserWindow>();

export function registerAuthWindow(win: BrowserWindow): void {
  subscribers.add(win);
  win.on('closed', () => subscribers.delete(win));
}

function emit(): void {
  for (const win of subscribers) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(IPC_CHANNELS.AUTH_STATE_CHANGED, state);
    } catch (e) {
      logger.warn('[authManager] failed to emit state', e);
    }
  }
}

function setState(patch: Partial<AuthState>): void {
  state = { ...state, ...patch };
  emit();
}

export function getState(): AuthState {
  return state;
}

// Captured so that auth:get-state can await an in-flight initialize()
// before responding. Without this, the renderer's first read can race
// against the relay validation call and receive {initialized: false},
// then miss the subsequent state-changed event and stay stuck on the
// "Starting Aeris…" splash forever.
let initializePromise: Promise<void> | null = null;
// #M3 — auth:get-state awaits this rather than the full initializePromise
// so the renderer leaves the splash as soon as the optimistic session is
// in place (not after the slow-relay validation round-trip).
let readyPromise: Promise<void> | null = null;
let resolveReady: (() => void) | null = null;

function markReady(): void {
  if (resolveReady) {
    resolveReady();
    resolveReady = null;
  }
}

export function initialize(): Promise<void> {
  if (!initializePromise) {
    if (!readyPromise) {
      readyPromise = new Promise<void>((res) => {
        resolveReady = res;
      });
    }
    initializePromise = doInitialize();
  }
  return initializePromise;
}

async function doInitialize(): Promise<void> {
  // try/finally so readyPromise resolves on every exit path — including the
  // 401 wipe and the network-error branch. Without this, a cold-start whose
  // persisted token gets rejected (or a synchronous throw before markReady)
  // leaves auth:get-state pending forever and the renderer stuck on splash.
  try {
    // Pull persisted session.
    const settings = settingsStore.get();
    state = {
      ...state,
      workspaceCode: settings.workspaceCode,
    };

    let token: string | null = null;
    let user: AuthUserSnapshot | null = null;
    let expiresAt: string | null = null;
    try {
      token = await tokenStore.getToken();
      user = await tokenStore.getUser();
      expiresAt = await tokenStore.getExpiresAt();
    } catch (e) {
      logger.warn('[authManager] tokenStore read failed', (e as Error)?.message);
    }

    // Wire 401 -> wipe session.
    setOnUnauthorized(() => {
      void handleUnauthorized();
    });

    if (!token) {
      setState({ initialized: true, isAuthenticated: false, user: null, expiresAt: null, errorKind: null });
      return;
    }

    // Token present — set on client.
    getRelayClient().setAuthToken(token);

    // #M3 — Mark initialized + flip the optimistic session immediately so
    // the renderer leaves the splash without waiting on the relay validation
    // round-trip (which can be ~23 s with RELAY_BUFFER_MS on a slow server).
    // The validation runs in the background and either confirms the
    // session, fires a 401 wipe, or leaves errorKind: 'network' for the
    // banner.
    setState({
      initialized: true,
      isAuthenticated: true,
      user,
      expiresAt,
      errorKind: null,
    });
    markReady();

    try {
      await getRelayClient().getDailySummary();
      // Confirmed — clear any transient error. State already reflects auth.
      setState({ errorKind: null });
      logger.info('[authManager] session restored');
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e?.status === 401) {
        // handleUnauthorized() already wiped state via onUnauthorized; tag
        // the errorKind for the renderer's "session expired" copy.
        setState({ errorKind: 'expired' });
        return;
      }
      // Network error — keep optimistic session so the user isn't bounced
      // to LoginScreen on a flaky cold start.
      logger.warn('[authManager] initial validation failed (non-401); keeping token', e?.message);
      setState({ errorKind: 'network' });
    }
  } finally {
    markReady();
  }
}

async function persistSession(
  token: string,
  user: AuthUserSnapshot | null,
  expiresAt: string | null,
): Promise<void> {
  await tokenStore.setToken(token);
  await tokenStore.setUser(user);
  await tokenStore.setExpiresAt(expiresAt);
}

async function clearSession(): Promise<void> {
  await tokenStore.clearAll();
}

export async function login(req: LoginRequest): Promise<AuthState> {
  const { workspaceCode, email, password } = req;
  if (!workspaceCode || !email || !password) {
    setState({ errorKind: 'invalid' });
    return state;
  }
  // Persist workspace code first so the relay client picks it up.
  settingsStore.set({ workspaceCode });
  getRelayClient().configure({ workspaceCode });

  try {
    const result = await getRelayClient().login(email, password, 'aeris-client');
    const token = result.access_token;
    const apiUser: AuthUserSnapshot | null = result.user
      ? {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role,
        }
      : null;
    const expiresAt = result.expires_at ?? null;

    if (!token) {
      setState({ errorKind: 'unknown' });
      return state;
    }

    try {
      await persistSession(token, apiUser, expiresAt);
    } catch (e) {
      // Token encrypt failed — leave the renderer at the login screen
      // rather than pretend we logged in.
      logger.error('[authManager] persist session failed', (e as Error)?.message);
      setState({ errorKind: 'unknown' });
      return state;
    }
    getRelayClient().setAuthToken(token);

    setState({
      isAuthenticated: true,
      user: apiUser,
      expiresAt,
      workspaceCode,
      errorKind: null,
    });
    logger.info('[authManager] login ok', { email });
    return state;
  } catch (err) {
    const e = err as Error & { status?: number };
    let kind: AuthErrorKind = 'unknown';
    if (e?.status === 401 || e?.status === 422) kind = 'invalid';
    else if (!e?.status) kind = 'network';
    logger.warn('[authManager] login failed', { kind, message: e?.message });
    setState({ errorKind: kind });
    return state;
  }
}

export async function logout(): Promise<AuthState> {
  try {
    await getRelayClient().logout();
  } catch (e) {
    // Best-effort — don't block local logout on a server failure.
    logger.warn('[authManager] server logout failed (continuing)', e);
  }
  await clearSession();
  getRelayClient().setAuthToken(null);
  setState({
    isAuthenticated: false,
    user: null,
    expiresAt: null,
    errorKind: null,
  });
  return state;
}

export async function handleUnauthorized(): Promise<void> {
  // Called when the relay returns 401 mid-session. Distinct from logout()
  // in that we tag errorKind: 'expired' so the renderer can show
  // "session expired" copy.
  await clearSession();
  getRelayClient().setAuthToken(null);
  setState({
    isAuthenticated: false,
    user: null,
    expiresAt: null,
    errorKind: 'expired',
  });
  logger.info('[authManager] 401 -> session wiped');
}

export function registerAuthIpc(): void {
  safeHandle(IPC_CHANNELS.AUTH_GET_STATE, async () => {
    // Only wait for the optimistic-session phase, not the slow relay
    // validation. See #M3 above.
    if (readyPromise) await readyPromise;
    return getState();
  });
  safeHandle(IPC_CHANNELS.AUTH_LOGIN, (_e, req) => login(req as LoginRequest));
  safeHandle(IPC_CHANNELS.AUTH_LOGOUT, () => logout());
}

// Test-only.
export function _resetForTests(): void {
  initializePromise = null;
  readyPromise = null;
  resolveReady = null;
  state = {
    initialized: false,
    isAuthenticated: false,
    user: null,
    expiresAt: null,
    workspaceCode: '',
    errorKind: null,
  };
}
