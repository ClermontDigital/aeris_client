import { ipcMain, BrowserWindow } from 'electron';
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
import { clearPin } from './appLockManager';
import { logger } from './logger';

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

export async function initialize(): Promise<void> {
  // Pull persisted session.
  const settings = settingsStore.get();
  state = {
    ...state,
    workspaceCode: settings.workspaceCode,
  };

  const token = await tokenStore.getToken();
  const user = await tokenStore.getUser();
  const expiresAt = await tokenStore.getExpiresAt();

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

  // Validate by trying a cheap relay call. On 401: wipe. On network error:
  // keep token, mark initialized, surface a transient banner.
  try {
    await getRelayClient().getDailySummary();
    setState({
      initialized: true,
      isAuthenticated: true,
      user,
      expiresAt,
      errorKind: null,
    });
    logger.info('[authManager] session restored');
  } catch (err) {
    const e = err as Error & { status?: number };
    if (e?.status === 401) {
      // Already wiped via onUnauthorized.
      setState({ initialized: true, errorKind: 'expired' });
      return;
    }
    // Network error — keep optimistic session so the user isn't bounced
    // to LoginScreen on a flaky cold start.
    logger.warn('[authManager] initial validation failed (non-401); keeping token', e?.message);
    setState({
      initialized: true,
      isAuthenticated: true,
      user,
      expiresAt,
      errorKind: 'network',
    });
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

    await persistSession(token, apiUser, expiresAt);
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
  // The PIN is per-installation but tied to the active user — clear it
  // on explicit logout so the next user/sign-in flow goes through PIN
  // setup again.
  try {
    clearPin();
  } catch (e) {
    logger.warn('[authManager] clearPin during logout failed', e);
  }
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
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_STATE, () => getState());
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGIN, (_e, req: LoginRequest) => login(req));
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, () => logout());
}

// Test-only.
export function _resetForTests(): void {
  state = {
    initialized: false,
    isAuthenticated: false,
    user: null,
    expiresAt: null,
    workspaceCode: '',
    errorKind: null,
  };
}
