import {create} from 'zustand';
import ApiClient, {RelayError} from '../services/ApiClient';
import {SecureStorage} from '../services/StorageService';
import {BACKGROUND_LOCK_MS} from '../constants/config';
import type {User} from '../types/api.types';

const AUTH_TOKEN_KEY = 'aeris_auth_token';
const AUTH_USER_KEY = 'aeris_auth_user';
const AUTH_EXPIRES_KEY = 'aeris_auth_expires_at';
const AUTH_BACKGROUNDED_AT_KEY = 'aeris_auth_backgrounded_at';
const AUTO_LOCK_MESSAGE = 'Auto-locked due to inactivity. Please log in again.';

interface AuthState {
  user: User | null;
  token: string | null;
  expiresAt: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  clearLocalSession: () => Promise<void>;
  markBackgrounded: () => Promise<void>;
  evaluateBackgroundLock: () => Promise<void>;
  clearError: () => void;
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const ts = Date.parse(expiresAt);
  if (Number.isNaN(ts)) return false;
  return ts <= Date.now();
}

// Read + clear the background-stamp. Returns true if the stamp existed and
// represents a window longer than BACKGROUND_LOCK_MS — i.e. the session
// should be locked on resume / cold-boot.
async function readAndClearBackgroundLock(): Promise<boolean> {
  const stamp = await SecureStorage.getItem(AUTH_BACKGROUNDED_AT_KEY);
  if (!stamp) return false;
  await SecureStorage.removeItem(AUTH_BACKGROUNDED_AT_KEY);
  const ts = parseInt(stamp, 10);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts > BACKGROUND_LOCK_MS;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  expiresAt: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  login: async (email: string, password: string) => {
    set({isLoading: true, error: null});
    try {
      const response = await ApiClient.login(email, password);
      const {access_token, expires_at, user} = response;
      ApiClient.setAuthToken(access_token);
      await SecureStorage.setItem(AUTH_TOKEN_KEY, access_token);
      await SecureStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
      if (expires_at) {
        await SecureStorage.setItem(AUTH_EXPIRES_KEY, expires_at);
      } else {
        await SecureStorage.removeItem(AUTH_EXPIRES_KEY);
      }
      set({
        user,
        token: access_token,
        expiresAt: expires_at ?? null,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (e) {
      let message = e instanceof Error ? e.message : 'Login failed';
      // The "workspace not found" copy only makes sense in relay mode. In
      // direct mode a 404 means a wrong server URL/route, which deserves a
      // different message. Gate the rewrite on relay mode.
      const isRelay = ApiClient.getMode() === 'relay';
      if (
        isRelay &&
        e instanceof RelayError &&
        (e.code === 'workspace_unknown' || e.code === 'WORKSPACE_UNKNOWN')
      ) {
        message = 'Workspace not found. Check the code and try again.';
      } else if (
        isRelay &&
        e instanceof Error &&
        (e as Error & {status?: number}).status === 404
      ) {
        message = 'Workspace not found. Check the code and try again.';
      }
      set({error: message, isLoading: false});
      throw e;
    }
  },

  logout: async () => {
    try {
      await ApiClient.logout();
    } catch {
      // Logout API call may fail if token is already expired — that's fine
    }
    ApiClient.setAuthToken(null);
    await SecureStorage.removeItem(AUTH_TOKEN_KEY);
    await SecureStorage.removeItem(AUTH_USER_KEY);
    await SecureStorage.removeItem(AUTH_EXPIRES_KEY);
    await SecureStorage.removeItem(AUTH_BACKGROUNDED_AT_KEY);
    set({
      user: null,
      token: null,
      expiresAt: null,
      isAuthenticated: false,
      error: null,
    });
  },

  // Wipes local auth state without calling the server. Used when the
  // server has already invalidated the session (401) so we don't loop
  // back through ApiClient.logout() which would just 401 again.
  clearLocalSession: async () => {
    ApiClient.setAuthToken(null);
    await SecureStorage.removeItem(AUTH_TOKEN_KEY);
    await SecureStorage.removeItem(AUTH_USER_KEY);
    await SecureStorage.removeItem(AUTH_EXPIRES_KEY);
    await SecureStorage.removeItem(AUTH_BACKGROUNDED_AT_KEY);
    set({
      user: null,
      token: null,
      expiresAt: null,
      isAuthenticated: false,
      error: 'Your session has expired. Please log in again.',
    });
  },

  // Stamp the background-entered timestamp so a subsequent resume / cold-boot
  // can decide whether to auto-lock. No-op if not authenticated (nothing to
  // lock). Stored in SecureStorage to survive iOS killing the suspended app.
  markBackgrounded: async () => {
    if (!get().isAuthenticated) return;
    try {
      await SecureStorage.setItem(AUTH_BACKGROUNDED_AT_KEY, String(Date.now()));
    } catch (e) {
      console.warn('Failed to stamp background timestamp:', e);
    }
  },

  // Called on resume from background. If the stamp exists and is older than
  // BACKGROUND_LOCK_MS, drops the local session and routes the user back to
  // LoginScreen. Cold-boot path is handled inside restoreSession().
  evaluateBackgroundLock: async () => {
    if (!get().isAuthenticated) return;
    if (await readAndClearBackgroundLock()) {
      await get().clearLocalSession();
      set({error: AUTO_LOCK_MESSAGE});
    }
  },

  restoreSession: async () => {
    set({isLoading: true});
    try {
      const token = await SecureStorage.getItem(AUTH_TOKEN_KEY);
      const userJson = await SecureStorage.getItem(AUTH_USER_KEY);
      const expiresAt = await SecureStorage.getItem(AUTH_EXPIRES_KEY);

      if (!token || !userJson) {
        // Nothing to restore — also clear any orphaned background stamp.
        await SecureStorage.removeItem(AUTH_BACKGROUNDED_AT_KEY);
        set({isLoading: false});
        return;
      }

      if (isExpired(expiresAt)) {
        await SecureStorage.removeItem(AUTH_TOKEN_KEY);
        await SecureStorage.removeItem(AUTH_USER_KEY);
        await SecureStorage.removeItem(AUTH_EXPIRES_KEY);
        await SecureStorage.removeItem(AUTH_BACKGROUNDED_AT_KEY);
        set({isLoading: false});
        return;
      }

      // Background-lock check: if iOS killed the app while suspended and the
      // user is reopening after the lock window, drop the session here so
      // the in-process AppState handler isn't required for correctness.
      if (await readAndClearBackgroundLock()) {
        await SecureStorage.removeItem(AUTH_TOKEN_KEY);
        await SecureStorage.removeItem(AUTH_USER_KEY);
        await SecureStorage.removeItem(AUTH_EXPIRES_KEY);
        set({isLoading: false, error: AUTO_LOCK_MESSAGE});
        return;
      }

      const user = JSON.parse(userJson) as User;
      ApiClient.setAuthToken(token);
      set({
        user,
        token,
        expiresAt,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      set({isLoading: false});
    }
  },

  clearError: () => set({error: null}),
}));
