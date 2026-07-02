import {create} from 'zustand';
import CookieManager from '@react-native-cookies/cookies';
import ApiClient, {RelayError} from '../services/ApiClient';
import {SecureStorage} from '../services/StorageService';
import {SilentReauthCredentialStore} from '../services/SilentReauthCredentialStore';
import {useSettingsStore} from './settingsStore';
import {
  hydrationPromise as workspaceFeaturesHydrationPromise,
  useWorkspaceFeaturesStore,
} from './workspaceFeaturesStore';
import {resetRepairsDisabledToastLatch} from '../services/ApiClient';
import type {User} from '../types/api.types';

// Drop every cookie the WebView accumulated this session. ERPScreen +
// MainScreen embed the Aeris2 webapp in a react-native-webview, and that
// view stores Laravel session cookies in the system cookie jar — those
// outlive the bearer token unless we explicitly wipe them. Called ONLY
// from the explicit `logout` path; the 401-driven `clearLocalSession`
// no longer wipes cookies because the gateway sets XSRF/session cookies
// that the next post-login call needs to carry — wiping on every 401
// caused the "tap Retry twice and it works" post-login symptom. Best-
// effort: catches/swallows failures so a cookie-store error never
// blocks the auth wipe.
async function clearWebViewCookies(): Promise<void> {
  try {
    await CookieManager.clearAll(true);  // true = include httpOnly
  } catch {
    // Ignored — cookie wipe is opportunistic; auth wipe must proceed.
  }
}

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

// Shape guard for the persisted User payload. Only the load-bearing fields
// are enforced — `id` and `email` are required for relay/RPC identity, and
// `name` (if present) must be a string so downstream screens that format
// it don't blow up. Other User fields (role, location_id) are nullable
// upstream so we tolerate their absence here.
function isPersistedUser(value: unknown): value is User {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'number') return false;
  if (typeof v.email !== 'string') return false;
  if (v.name !== undefined && typeof v.name !== 'string') return false;
  return true;
}

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
    // Reset just the banner state — DO NOT set `isLoading: true` here.
    // The global isLoading flag is gated by RootNavigator (returns null
    // → blank screen while true). It's intended for the cold-start
    // restoreSession path only. Setting it during an active login
    // attempt blanks the entire app for the network round-trip; on a
    // 401 the user sees a white screen instead of the error banner
    // they're owed. LoginScreen tracks its own local `isSigningIn`
    // state for button + input disabled UX.
    set({error: null, errorKind: null});
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
      // Same shape guard as restoreSession — a relay deploy that changes
      // the user payload shape would otherwise crash downstream screens
      // immediately after a successful login. Reject loudly here so the
      // user sees "Sign in failed" rather than the generic ErrorBoundary.
      if (!isPersistedUser(user)) {
        const err = new Error('Login response missing required user fields');
        (err as Error & {status?: number}).status = 422;
        throw err;
      }
      ApiClient.setAuthToken(access_token);
      // "Keep me signed in" toggle (settingsStore.keepSignedIn). True (default)
      // persists the token into SecureStorage so the cold-start
      // restoreSession flow finds it and the user lands directly on the
      // Dashboard. False keeps the token in zustand-only — kill-and-relaunch
      // forces a fresh login. Either way the in-memory state below makes
      // the user immediately authenticated for THIS app launch.
      const keepSignedIn = s?.keepSignedIn !== false;
      if (keepSignedIn) {
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
      } else {
        // Defensive: clear any stale persisted creds from a prior session
        // where the user HAD keepSignedIn on. Otherwise toggling off then
        // logging in could leave an old token in the Keychain.
        await SecureStorage.removeItem(AUTH_TOKEN_KEY);
        await SecureStorage.removeItem(AUTH_USER_KEY);
        await SecureStorage.removeItem(AUTH_EXPIRES_KEY);
      }
      set({
        user,
        token: access_token,
        expiresAt: expires_at ?? null,
        isAuthenticated: true,
        error: null,
        errorKind: null,
      });
      // T2 — hydrate per-deployment feature flags from the login response so
      // repairs_enabled reflects THIS workspace before any RPC / render. Missing
      // envelope coerces to false at the store boundary (safe default). NOTE:
      // no counterpart wipe on logout — a fresh login rehydrates.
      useWorkspaceFeaturesStore.getState().hydrateFromLogin(response);
      // M3-C — cache the credentials for SILENT re-auth across a future auto
      // mode-switch (failover/failback wipes the audience-specific bearer, and
      // auth.biometric can't run without a live token). SECURITY GATE: only
      // when autoFailoverEnabled is ON — a default (flag-off) build caches
      // NOTHING. Scoped to the active workspace code; wiped on explicit logout.
      // See SilentReauthCredentialStore for the full threat model. Best-effort
      // (never blocks login, never logs the credential).
      const autoFailoverEnabled = s?.autoFailoverEnabled === true;
      await SilentReauthCredentialStore.save(
        autoFailoverEnabled,
        s?.workspaceCode ?? null,
        email,
        password,
      );
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
      // Replace the raw transport message ("Network request failed",
      // "Aborted", etc.) with friendlier copy when the failure is a
      // transport-layer issue. The reviewer-facing surface is the
      // login screen, so a generic "couldn't reach the server" reads
      // better than the platform error.
      if (errorKind === 'network') {
        message = isRelay
          ? "Couldn't reach the AERIS cloud. Check your connection and try again."
          : "Couldn't reach the AERIS server. Check the server URL and your connection.";
      }
      set({error: message, errorKind});
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
    // M3-C — explicit logout WIPES the cached silent-re-auth credential (the
    // "I'm deliberately leaving" path in the threat model). NOTE: the 401-driven
    // clearLocalSession deliberately does NOT wipe — it fires DURING an auto
    // mode-switch, which is exactly when the cache is needed to re-auth.
    await SilentReauthCredentialStore.clear();
    await clearWebViewCookies();
    // Workspace feature flags: reset on explicit logout so a NEXT user
    // logging into a DIFFERENT deployment on the same device doesn't briefly
    // see the previous user's repairs_enabled = true before hydrateFromLogin
    // rewrites it. Also resets the ApiClient toast latch so a mid-session
    // OFF → next login → OFF cycle still surfaces the "Repairs disabled"
    // toast on the second flip.
    useWorkspaceFeaturesStore.getState().reset();
    resetRepairsDisabledToastLatch();
    // PIN persists across logout — only Settings → Reset PIN clears it.
    // Cross-platform parity with desktop; on next login the cold-start
    // lock effect in App.tsx prompts for the existing PIN.
    // refreshInFlight: null nukes any race where the proactive refresh
    // timer's in-flight promise resolves AFTER logout fires and sets
    // {token, expiresAt, user} on a logged-out store — briefly re-
    // authenticating the user. The in-flight `run` body checks the
    // post-await store state too (see below).
    set({
      user: null,
      token: null,
      expiresAt: null,
      isAuthenticated: false,
      error: null,
      errorKind: null,
      refreshInFlight: null,
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
    // M3-C (go-live doc): clearLocalSession INTENTIONALLY PRESERVES the cached
    // silent-reauth credential. This path fires on a 401 — including the one
    // the auto mode-switch itself triggers (the old-edge bearer is rejected by
    // the new edge) — which is EXACTLY when the cache is needed to re-auth
    // against the new edge. Only explicit logout() and flushForRepair() (re-pair)
    // wipe it; the TTL counter wipes it after N consecutive silent-reauth
    // failures. See SilentReauthCredentialStore threat model items 2 + the TTL.
    // DO NOT wipe cookies here. The gateway may set XSRF / session
    // cookies on the first call that subsequent calls expect; nuking
    // them on every 401-driven session wipe was the cause of the
    // post-login "tap Retry twice and it works" symptom — the user's
    // freshly-minted bearer first call 401'd because the cookie was
    // gone, then the failed response set the cookie, and the second
    // tap finally succeeded. Cookies belong to explicit `logout`
    // (where the user deliberately leaves) and to the WebView, not to
    // the auth-rejection wipe path.
    set({
      user: null,
      token: null,
      expiresAt: null,
      isAuthenticated: false,
      error: 'Your session has expired. Please log in again.',
      errorKind: 'expired',
      refreshInFlight: null,
    });
  },

  restoreSession: async () => {
    set({isLoading: true});
    // Outer try/finally guarantees `isLoading: false` is set on every exit
    // path — including a Keychain throw inside the malformed-user wipe
    // branch, which previously left the app on the splash forever if a
    // `SecureStorage.removeItem` call failed mid-wipe.
    try {
      // Await the workspaceFeaturesStore warm-boot restore BEFORE setting
      // isAuthenticated. Without this, the app renders with repairs_enabled
      // stuck at its default `false` and the Repairs tab pops in only after
      // the async SecureStorage read resolves — a visible flicker on cold
      // start. Best-effort: a hydration failure just leaves the default in
      // place, which is the safe posture.
      await workspaceFeaturesHydrationPromise;
      const token = await SecureStorage.getItem(AUTH_TOKEN_KEY);
      const userJson = await SecureStorage.getItem(AUTH_USER_KEY);
      const expiresAt = await SecureStorage.getItem(AUTH_EXPIRES_KEY);

      if (!token || !userJson) {
        // Nothing to restore — also drop any orphaned legacy stamps from
        // older builds.
        await SecureStorage.removeItem(LEGACY_BACKGROUNDED_AT_KEY).catch(() => {});
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
        const parsed: unknown = JSON.parse(userJson);
        // Shape-check the persisted user. After weeks idle, a payload from
        // a prior build (or partial write) may be missing fields or have
        // the wrong types; downstream screens crash on the first
        // `user.name.toUpperCase()` style access, surfacing as the generic
        // "undefined is not a function" ErrorBoundary. Bail out cleanly
        // and route the user back to login instead.
        if (!isPersistedUser(parsed)) {
          throw new Error('user shape mismatch');
        }
        user = parsed;
      } catch {
        console.warn('authStore: stored user JSON malformed, clearing');
        // Best-effort wipe — wrap each remove individually so a Keychain
        // failure on one key doesn't abort the others. Each .catch
        // suppresses; the outer finally still releases the splash.
        await SecureStorage.removeItem(AUTH_USER_KEY).catch(() => {});
        await SecureStorage.removeItem(AUTH_TOKEN_KEY).catch(() => {});
        await SecureStorage.removeItem(AUTH_EXPIRES_KEY).catch(() => {});
        await SecureStorage.removeItem(LEGACY_BACKGROUNDED_AT_KEY).catch(() => {});
        return;
      }
      ApiClient.setAuthToken(token);
      set({
        user,
        token,
        expiresAt,
        isAuthenticated: true,
      });
      // T2 — workspaceFeaturesStore restores its own persisted slice at module
      // load (SecureStorage key 'aeris.workspace.features'), so the flag is
      // already populated by the time we get here. The next refreshToken tick
      // will re-hydrate from a live AuthResponse; until then the last-known
      // deployment posture stands.
      // Best-effort cleanup of legacy stamp.
      SecureStorage.removeItem(LEGACY_BACKGROUNDED_AT_KEY).catch(() => {});
    } catch (e) {
      console.warn('authStore.restoreSession failed:', e);
    } finally {
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
        // The refresh round-trip may take seconds; the user could have
        // tapped Logout in the meantime. Abort the commit if so —
        // otherwise we'd silently re-authenticate them with a freshly
        // minted token on top of a deliberately-cleared session.
        if (!get().isAuthenticated) {
          ApiClient.setAuthToken(null);
          return;
        }
        const {access_token, expires_at, user} = response;
        ApiClient.setAuthToken(access_token);
        // Honour the "Keep me signed in" opt-out (settingsStore.keepSignedIn).
        // The login() flow gates SecureStorage writes on this flag; the
        // proactive refresh path must do the same, otherwise a user who
        // opted out gets their token silently re-persisted to the Keychain
        // ~2min later and restoreSession() resurrects them on the next cold
        // start — defeating the opt-out. If the flag flipped true→false at
        // some point during the live session, also proactively wipe any
        // stale persisted creds from the earlier opted-in window.
        const keepSignedIn =
          useSettingsStore.getState().settings?.keepSignedIn !== false;
        // Only persist + commit `user` if it shape-checks. A malformed
        // user blob from a refresh response would otherwise replace the
        // valid in-memory user and crash the next render. The previous
        // valid `user` in state stays as-is when the refresh skips this.
        const userOk = user !== undefined && isPersistedUser(user);
        if (keepSignedIn) {
          await SecureStorage.setItem(AUTH_TOKEN_KEY, access_token);
          if (userOk) {
            await SecureStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
          }
          if (expires_at) {
            await SecureStorage.setItem(AUTH_EXPIRES_KEY, expires_at);
          } else {
            await SecureStorage.removeItem(AUTH_EXPIRES_KEY);
          }
        } else {
          // Opted out — scrub any creds the Keychain might still be holding
          // from an earlier opted-in window (or a prior build). The new
          // token lives in zustand only; kill-and-relaunch forces a fresh
          // login.
          await SecureStorage.removeItem(AUTH_TOKEN_KEY).catch(() => {});
          await SecureStorage.removeItem(AUTH_USER_KEY).catch(() => {});
          await SecureStorage.removeItem(AUTH_EXPIRES_KEY).catch(() => {});
        }
        // Re-check post-write — the user could log out during the awaits
        // above (Keychain writes can take ~tens of ms). If so, wipe what
        // we just persisted.
        if (!get().isAuthenticated) {
          ApiClient.setAuthToken(null);
          if (keepSignedIn) {
            await SecureStorage.removeItem(AUTH_TOKEN_KEY).catch(() => {});
            if (userOk) {
              await SecureStorage.removeItem(AUTH_USER_KEY).catch(() => {});
            }
            await SecureStorage.removeItem(AUTH_EXPIRES_KEY).catch(() => {});
          }
          return;
        }
        set({
          token: access_token,
          expiresAt: expires_at ?? null,
          ...(userOk ? {user} : {}),
          error: null,
          errorKind: null,
        });
        // T2 — re-hydrate feature flags on every refresh so an ON→OFF flip on
        // the deployment side propagates within one Sanctum window. Missing
        // envelope coerces to false (safe default).
        useWorkspaceFeaturesStore.getState().hydrateFromLogin(response);
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
