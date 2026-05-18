import {create} from 'zustand';
import ApiClient, {RelayError} from '../services/ApiClient';
import {SecureStorage} from '../services/StorageService';
import {useSettingsStore} from './settingsStore';
import type {User} from '../types/api.types';

const AUTH_TOKEN_KEY = 'aeris_auth_token';
const AUTH_USER_KEY = 'aeris_auth_user';
const AUTH_EXPIRES_KEY = 'aeris_auth_expires_at';
// Legacy key from the (now-removed) background auto-lock feature. Cleaned
// up opportunistically on logout / clearLocalSession / token-missing
// restore so a stale stamp left over from an older build doesn't bleed.
const LEGACY_BACKGROUNDED_AT_KEY = 'aeris_auth_backgrounded_at';

// Discriminator for the LoginScreen's banner. `error` (the human-readable
// string) is kept around for backward-compat — `errorKind` lets the screen
// pick a distinct visual treatment for each cause. 'expired' means
// "we wiped your session because the API rejected the token"; 'invalid'
// means "the credentials you just entered are wrong"; 'network' means
// "we couldn't reach the server".
export type AuthErrorKind = 'expired' | 'invalid' | 'network' | null;

interface AuthState {
  user: User | null;
  token: string | null;
  expiresAt: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  errorKind: AuthErrorKind;
  // In-flight refresh promise — used by refreshSession() to dedupe
  // simultaneous refresh attempts (e.g. timer firing while AppState change
  // also kicks one off). Not exposed externally.
  refreshInFlight: Promise<void> | null;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
  clearLocalSession: () => Promise<void>;
  clearError: () => void;
  refreshSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  expiresAt: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  errorKind: null,
  refreshInFlight: null,

  login: async (email: string, password: string) => {
    set({isLoading: true, error: null, errorKind: null});
    try {
      // Reactive ApiClient.configure in App.tsx lags one render behind a
      // just-saved workspaceCode/baseUrl — call configure synchronously
      // here so the LoginScreen's first request always sees the current
      // settings (otherwise the first login attempt 404s the wrong URL
      // and the user has to retry).
      const s = useSettingsStore.getState().settings;
      ApiClient.configure({
        baseUrl: s?.baseUrl,
        relayUrl: s?.relayUrl,
        mode: s?.connectionMode,
        workspaceCode: s?.workspaceCode,
      });
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
        error: null,
        errorKind: null,
      });
    } catch (e) {
      let message = e instanceof Error ? e.message : 'Login failed';
      // The "workspace not found" copy only makes sense in relay mode. In
      // direct mode a 404 means a wrong server URL/route, which deserves a
      // different message. Gate the rewrite on relay mode.
      const isRelay = ApiClient.getMode() === 'relay';
      const status = (e as Error & {status?: number}).status;
      let errorKind: AuthErrorKind = 'invalid';

      if (
        isRelay &&
        e instanceof RelayError &&
        (e.code === 'workspace_unknown' || e.code === 'WORKSPACE_UNKNOWN')
      ) {
        message = 'Workspace not found. Check the code and try again.';
        errorKind = 'invalid';
      } else if (
        isRelay &&
        e instanceof Error &&
        status === 404
      ) {
        message = 'Workspace not found. Check the code and try again.';
        errorKind = 'invalid';
      } else if (status === 401) {
        errorKind = 'invalid';
      } else if (status === 404) {
        errorKind = 'invalid';
      } else if (e instanceof RelayError && e.code === 'TIMEOUT') {
        errorKind = 'network';
      } else if (e instanceof Error && status === undefined && !(e instanceof RelayError)) {
        // No status set → transport failure (timeout, abort, DNS).
        errorKind = 'network';
      }
      set({error: message, errorKind, isLoading: false});
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
    // PIN persists across logout — only Settings → Reset PIN clears it.
    // Cross-platform parity with desktop; on next login the cold-start
    // lock effect in App.tsx prompts for the existing PIN.
    set({
      user: null,
      token: null,
      expiresAt: null,
      isAuthenticated: false,
      error: null,
      errorKind: null,
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
      errorKind: 'expired',
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
      let user: User;
      try {
        user = JSON.parse(userJson) as User;
      } catch {
        console.warn('authStore: stored user JSON malformed, clearing');
        await SecureStorage.removeItem(AUTH_USER_KEY);
        await SecureStorage.removeItem(AUTH_TOKEN_KEY);
        await SecureStorage.removeItem(AUTH_EXPIRES_KEY);
        await SecureStorage.removeItem(LEGACY_BACKGROUNDED_AT_KEY);
        set({isLoading: false});
        return;
      }
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

  clearError: () => set({error: null, errorKind: null}),

  // Mints a fresh Sanctum token before the current one expires. Two callers:
  // the proactive setTimeout in App.tsx (fires ~2min before expiresAt) and
  // the AppState foreground listener (fires when the app comes back to
  // foreground close to expiry). Both routes share the same in-flight
  // promise via refreshInFlight so we never produce duplicate concurrent
  // refresh requests against Sanctum.
  refreshSession: async () => {
    const existing = get().refreshInFlight;
    if (existing) {
      // Caller awaits the in-flight promise rather than firing a second
      // request. Swallow errors here — the original initiator handles them.
      await existing.catch(() => {});
      return;
    }

    const run = async (): Promise<void> => {
      try {
        const response = await ApiClient.refreshToken();
        const {access_token, expires_at, user} = response;
        ApiClient.setAuthToken(access_token);
        await SecureStorage.setItem(AUTH_TOKEN_KEY, access_token);
        if (user) {
          await SecureStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
        }
        if (expires_at) {
          await SecureStorage.setItem(AUTH_EXPIRES_KEY, expires_at);
        } else {
          await SecureStorage.removeItem(AUTH_EXPIRES_KEY);
        }
        set({
          token: access_token,
          expiresAt: expires_at ?? null,
          ...(user ? {user} : {}),
          error: null,
          errorKind: null,
        });
      } catch (e) {
        const status = (e as Error & {status?: number}).status;
        const isAuthRejection =
          status === 401 ||
          (e instanceof RelayError &&
            (e.code === 'UNAUTHENTICATED' ||
              e.code === 'unauthenticated' ||
              e.code === 'UNAUTHORIZED' ||
              e.code === 'unauthorized'));
        if (isAuthRejection) {
          // Token already invalid server-side — wipe local state and route
          // the user back to LoginScreen with the expired banner.
          await get().clearLocalSession();
          return;
        }
        // Transient / network failure — leave the session as-is so the next
        // user-traffic call's natural 401 (if any) handles wipe. Re-throw
        // so callers can log; App.tsx silently swallows.
        console.warn('refreshSession failed:', e);
        throw e;
      }
    };

    const promise = run();
    set({refreshInFlight: promise});
    try {
      await promise;
    } finally {
      set({refreshInFlight: null});
    }
  },
}));
