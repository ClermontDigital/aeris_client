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

// initializePromise lets callers await the cold-start path; auth:get-state
// awaits this directly so renderer reads can never race ahead of the
// optimistic-session setState (which is the only point where isAuthenticated
// flips from the default false to true on restore).
let initializePromise: Promise<void> | null = null;

export function initialize(): Promise<void> {
  if (!initializePromise) {
    initializePromise = doInitialize();
  }
  return initializePromise;
}

async function doInitialize(): Promise<void> {
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

  // Wire 401 -> wipe session. From here on, ANY relay call (renderer or
  // main) that returns 401 routes through handleUnauthorized() to wipe
  // the session and tag errorKind: 'expired' for the LoginScreen banner.
  setOnUnauthorized(() => {
    void handleUnauthorized();
  });

  if (!token) {
    setState({ initialized: true, isAuthenticated: false, user: null, expiresAt: null, errorKind: null });
    return;
  }

  // Token present — apply it to the client and flip auth optimistically.
  // We deliberately do NOT validate by firing a probe call here: the
  // renderer's first real query (Dashboard's getDailySummary, etc.) will
  // either succeed or 401, and the onUnauthorized wiring handles the 401
  // path. Probing here previously caused a duplicate cold-start fetch
  // whose transient relay-edge 5xx surfaced as a spurious "Couldn't reach
  // the server" banner even though the session was valid.
  getRelayClient().setAuthToken(token);
  setState({
    initialized: true,
    isAuthenticated: true,
    user,
    expiresAt,
    errorKind: null,
  });
  logger.info('[authManager] session restored (optimistic)');
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
    // Idempotently kick + await initialize() so the IPC handler can never
    // out-race the boot ordering in main/index.ts. If initialize() has
    // already been called (the normal path), this just awaits the
    // memoised promise; if it somehow hasn't, this drives it.
    await initialize();
    return getState();
  });
  safeHandle(IPC_CHANNELS.AUTH_LOGIN, (_e, req) => login(req as LoginRequest));
  safeHandle(IPC_CHANNELS.AUTH_LOGOUT, () => logout());
}

// Test-only.
export function _resetForTests(): void {
  initializePromise = null;
  state = {
    initialized: false,
    isAuthenticated: false,
    user: null,
    expiresAt: null,
    workspaceCode: '',
    errorKind: null,
  };
}
