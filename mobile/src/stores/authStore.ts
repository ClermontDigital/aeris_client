import {create} from 'zustand';
import ApiClient, {RelayError} from '../services/ApiClient';
import {SecureStorage} from '../services/StorageService';
import type {User} from '../types/api.types';

const AUTH_TOKEN_KEY = 'aeris_auth_token';
const AUTH_USER_KEY = 'aeris_auth_user';
const AUTH_EXPIRES_KEY = 'aeris_auth_expires_at';
// Legacy key from the (now-removed) background auto-lock feature. Cleaned
// up opportunistically on logout / clearLocalSession / token-missing
// restore so a stale stamp left over from an older build doesn't bleed.
const LEGACY_BACKGROUNDED_AT_KEY = 'aeris_auth_backgrounded_at';

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
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
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
      // expires_at is persisted for read-back / display purposes only —
      // it is NOT acted on locally. The session stays live until the user
      // explicitly logs out or the API returns 401 (handled below via
      // ApiClient.setOnUnauthorized → clearLocalSession). Honoring
      // expires_at here would preempt the API and produce surprise
      // logouts; the API is the source of truth for token validity.
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
    await SecureStorage.removeItem(LEGACY_BACKGROUNDED_AT_KEY);
    set({
      user: null,
      token: null,
      expiresAt: null,
      isAuthenticated: false,
      error: null,
    });
  },

  // Wipes local auth state without calling the server. Triggered when the
  // API rejects the token (HTTP 401) so we don't loop back through
  // ApiClient.logout() which would just 401 again. This is the ONLY
  // automatic session-wipe path — there is no background-timeout, no
  // expires_at preempt, no inactivity lock. The session stays live until
  // either (a) the user taps Logout, or (b) the API says 401 here.
  clearLocalSession: async () => {
    ApiClient.setAuthToken(null);
    await SecureStorage.removeItem(AUTH_TOKEN_KEY);
    await SecureStorage.removeItem(AUTH_USER_KEY);
    await SecureStorage.removeItem(AUTH_EXPIRES_KEY);
    await SecureStorage.removeItem(LEGACY_BACKGROUNDED_AT_KEY);
    set({
      user: null,
      token: null,
      expiresAt: null,
      isAuthenticated: false,
      error: 'Your session has expired. Please log in again.',
    });
  },

  restoreSession: async () => {
    set({isLoading: true});
    try {
      const token = await SecureStorage.getItem(AUTH_TOKEN_KEY);
      const userJson = await SecureStorage.getItem(AUTH_USER_KEY);
      const expiresAt = await SecureStorage.getItem(AUTH_EXPIRES_KEY);

      if (!token || !userJson) {
        // Nothing to restore — also drop any orphaned legacy stamps from
        // older builds.
        await SecureStorage.removeItem(LEGACY_BACKGROUNDED_AT_KEY);
        set({isLoading: false});
        return;
      }

      // Restore the session as-is — we deliberately do NOT check
      // expires_at or any other "is this token still valid" heuristic.
      // The next API call will tell us via 401 if the deployment has
      // invalidated the token, and the onUnauthorized handler will route
      // the user back to login at that moment. This matches the policy
      // "stay logged in until logout or API rejection".
      const user = JSON.parse(userJson) as User;
      ApiClient.setAuthToken(token);
      set({
        user,
        token,
        expiresAt,
        isAuthenticated: true,
        isLoading: false,
      });
      // Best-effort cleanup of legacy stamp.
      SecureStorage.removeItem(LEGACY_BACKGROUNDED_AT_KEY).catch(() => {});
    } catch {
      set({isLoading: false});
    }
  },

  clearError: () => set({error: null}),
}));
