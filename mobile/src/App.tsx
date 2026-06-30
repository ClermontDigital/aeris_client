import React, {useCallback, useEffect, useRef} from 'react';
import {BackHandler, StatusBar, Platform, View, Text, StyleSheet, TouchableOpacity, AppState, AppStateStatus, Linking} from 'react-native';

// ---------------------------------------------------------------------------
// React Native 0.83.4 removed the imperative `BackHandler.removeEventListener`
// API (the new shape returns a subscription whose `.remove()` does the unsub).
// `react-native-modal` v13.0.1, which we use for StockAdjustModal /
// SettingsModal / Session*Modal, still calls the removed API in its
// `componentWillUnmount`. The throw propagates as "undefined is not a
// function" and any time a screen owning one of these modals unmounts (e.g.
// popping ProductDetail by tapping the Items tab) the App.tsx ErrorBoundary
// catches it and the user sees "Something went wrong + Retry → Dashboard".
//
// Polyfill the removed method as a no-op BEFORE any modal mounts. Safe
// because on RN 0.83 the addEventListener subscription's `.remove()` is the
// real unsub path — there's nothing for the legacy API to actually clean up.
// Lives outside the React tree so it runs at module-load.
//
// TODO(react-native-modal): remove this shim when react-native-modal is
// bumped to a version that uses the subscription `.remove()` pattern (v14+).
// ---------------------------------------------------------------------------
{
  const bh = BackHandler as unknown as {
    removeEventListener?: (...args: unknown[]) => void;
  };
  if (typeof bh.removeEventListener !== 'function') {
    bh.removeEventListener = () => {};
  }
}

import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NavigationContainer} from '@react-navigation/native';
import {activateKeepAwakeAsync} from 'expo-keep-awake';
import {useFonts} from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import {useSettingsStore} from './stores/settingsStore';
import {useAuthStore} from './stores/authStore';
import {useProductCacheStore} from './stores/productCacheStore';
import {useAppLockStore} from './stores/appLockStore';
import {useDrStore} from './stores/drStore';
import {useCloudReachabilityStore} from './stores/cloudReachabilityStore';
import {usePresenceBeacon} from './hooks/usePresenceBeacon';
import {useFailoverDetection} from './hooks/useFailoverDetection';
import {useDrRoutingPoll} from './hooks/useDrRoutingPoll';
import {useNasHealthProbe} from './hooks/useNasHealthProbe';
import {useAutoFailover} from './hooks/useAutoFailover';
import ApiClient from './services/ApiClient';
import RootNavigator from './navigation/RootNavigator';
import AppLockScreen from './screens/AppLockScreen';
import PinSetupScreen from './screens/PinSetupScreen';
import {COLORS, FONT_FAMILY} from './constants/theme';

// Keep the native splash visible while Poppins loads in parallel with the
// rest of the boot sequence. preventAutoHideAsync returns a promise that
// resolves with a boolean and rejects only if called after auto-hide has
// already fired; swallow the warning so a hot-reload doesn't spam the
// console.
SplashScreen.preventAutoHideAsync().catch(() => {});

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<
  {children: React.ReactNode},
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {hasError: false, error: null};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {hasError: true, error};
  }

  handleRetry = () => {
    this.setState({hasError: false, error: null});
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={errorStyles.container}>
          <Text style={errorStyles.title}>Something went wrong</Text>
          <Text style={errorStyles.message}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </Text>
          <TouchableOpacity style={errorStyles.button} onPress={this.handleRetry}>
            <Text style={errorStyles.buttonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const errorStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.navy,
    padding: 24,
  },
  title: {fontSize: 22, fontFamily: FONT_FAMILY.bold, color: COLORS.crimson, marginBottom: 12},
  message: {fontSize: 14, color: COLORS.textOnDark, textAlign: 'center', marginBottom: 24},
  button: {
    backgroundColor: COLORS.crimson,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 999,
  },
  buttonText: {color: COLORS.textOnDark, fontSize: 16, fontFamily: FONT_FAMILY.medium},
});

const App: React.FC = () => {
  // Poppins via expo-font. useFonts kicks off the load on first render in
  // parallel with the init useEffect below — they do not gate each other,
  // so the total cold-start cost is max(font_load, init), not the sum.
  // Capture the error too: if a font asset fails to decode (corrupt asset
  // on a bad OTA, OOM on low-end Android), we must NOT sit on a black
  // screen forever — proceed without Poppins and let the system font
  // fall through.
  const [fontsLoaded, fontError] = useFonts({
    'Poppins-Regular': require('../assets/fonts/Poppins-Regular.ttf'),
    'Poppins-Medium': require('../assets/fonts/Poppins-Medium.ttf'),
    'Poppins-SemiBold': require('../assets/fonts/Poppins-SemiBold.ttf'),
    'Poppins-Bold': require('../assets/fonts/Poppins-Bold.ttf'),
  });
  if (fontError) {
    console.warn('[App] Poppins font failed to load — falling back to system font.', fontError);
  }
  const fontsReady = fontsLoaded || !!fontError;

  const initSettings = useSettingsStore(s => s.init);
  const settings = useSettingsStore(s => s.settings);
  const settingsLoading = useSettingsStore(s => s.isLoading);
  const restoreSession = useAuthStore(s => s.restoreSession);
  const clearLocalSession = useAuthStore(s => s.clearLocalSession);
  const restoreCache = useProductCacheStore(s => s.restoreCache);
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const authLoading = useAuthStore(s => s.isLoading);
  const expiresAt = useAuthStore(s => s.expiresAt);
  const refreshSession = useAuthStore(s => s.refreshSession);
  const initAppLock = useAppLockStore(s => s.init);
  const initDr = useDrStore(s => s.init);
  const lockNow = useAppLockStore(s => s.lockNow);

  // §19.4 presence beacon — fires {device_id, mode, app_version} on a 60s
  // cadence + on foreground while authenticated. No-op until login.
  usePresenceBeacon();
  // M-R6 (§19.2 rule 5): single producer of the failoverAbortStore
  // NAS-unavailable signal → auto-surfaces the "NAS unreachable" banner when
  // the NAS is unusable mid-outage (detection only — no auto-switch; M2).
  useFailoverDetection();
  // M3-0 — consume the dr.routing delivery seam: fetch the deployment's cached
  // DR routing state on a cadence (relay user-traffic, post-login) and feed it
  // through drStore's validate→probe→commit pipeline. No-op on non-DR
  // deployments (404 → graceful M2 manual path).
  useDrRoutingPoll();
  // M3-A — continuous NAS reachability probe while a failover target is cached
  // (replaces the one-time validation); feeds the routing cascade + the
  // nasUnavailable banner producer. Cheap on-LAN; no-op with no cached target.
  useNasHealthProbe();
  // M3-A — the flag-gated auto endpoint-swap orchestrator. No-op unless the
  // autoFailoverEnabled flag is ON (default OFF) AND the cascade returns
  // 'outage-auto' (cloud-unreachable-per-hysteresis + reachable validated NAS +
  // cert-ok + not mid-transaction). Leaves the user at re-login (M3-C next).
  useAutoFailover();
  const isLocked = useAppLockStore(s => s.isLocked);
  const hasPin = useAppLockStore(s => s.hasPin);
  const lockInitialized = useAppLockStore(s => s.initialized);

  // Hide the native splash only when BOTH the font load has settled AND the
  // first useful UI is about to paint. v1.3.20 hid the splash the moment
  // `fontsReady` flipped — on a slow Android cold boot where fonts resolve
  // before `restoreSession` (and friends) does, the native splash dropped
  // ahead of the navigator's first paint and the user saw a brief navy
  // <View> flash bridge between the two layers. Couple the gate to the
  // boot pipeline (settings + auth done loading) so the brand splash holds
  // continuously into the navigator's first frame.
  //
  // The 1.5s fallback guarantees we never re-introduce the original
  // "splash stuck forever" bug: if either store wedges (network hang in
  // initSettings, secure-store read deadlocks restoreSession, font asset
  // takes its time to decode after the timer races ahead), we still drop
  // the native splash and let the JS-side `showSplash` <View> bridge the
  // remainder.
  const splashHiddenRef = useRef(false);
  const hideSplashOnce = useCallback(() => {
    if (splashHiddenRef.current) return;
    splashHiddenRef.current = true;
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    if (splashHiddenRef.current) return;
    const bootReady = fontsReady && !settingsLoading && !authLoading;
    if (bootReady) {
      hideSplashOnce();
      return;
    }
    if (!fontsReady) return;
    // Fonts have settled but the async boot chain is still running.
    // Arm the 1.5s safety net so a wedged init can't keep the splash up.
    const timer = setTimeout(hideSplashOnce, 1500);
    return () => clearTimeout(timer);
  }, [fontsReady, settingsLoading, authLoading, hideSplashOnce]);

  useEffect(() => {
    let cancelled = false;
    // Serialise boot so settings (baseUrl/relayUrl/mode/workspaceCode)
    // are applied to ApiClient BEFORE restoreSession sets the bearer
    // token. Parallel init lets the token land on a not-yet-configured
    // client; the first call can route to the wrong URL and surface as
    // the ErrorBoundary "Something went wrong" fallback on first login.
    (async () => {
      try {
        activateKeepAwakeAsync();
        await initSettings();
        if (cancelled) return;
        // Wire onUnauthorized BEFORE restoreSession so if a relay call fires
        // immediately after the bearer is re-applied to ApiClient (e.g. the
        // Dashboard fetches on mount and the persisted token has been
        // server-revoked overnight), the 401 routes through clearLocalSession
        // and the user is bounced to login cleanly. Previously this was set
        // AFTER restoreSession + cache + lock init — leaving a race window
        // where the first 401 of a session had no handler.
        ApiClient.setOnUnauthorized(() => {
          clearLocalSession();
        });
        // Refresh-on-401 hook: when a user-traffic call returns 401, the
        // transport calls this once before firing onUnauthorized. If a fresh
        // token lands, the original call is retried transparently so a
        // routine token expiry no longer kicks the user back to login
        // mid-task. Returns true on success (post-refresh token differs
        // from pre-refresh token + is non-null) so the transport knows to
        // proceed with the retry.
        ApiClient.setOnRefresh(async () => {
          try {
            await useAuthStore.getState().refreshSession();
            // Success criterion: there's still a non-null token after the
            // refresh completes. refreshSession only commits the new bearer
            // when the server returned 2xx; on 401 it calls
            // clearLocalSession (token → null), on transient failures it
            // leaves the existing token in place. Comparing token-before
            // vs token-after would yield a false negative when the server
            // renews expiry without rotating the bearer string.
            const after = useAuthStore.getState().token;
            // A completed refresh round-trip means the cloud answered →
            // positive cloud-reachability signal for the §14.7 Q9 banner.
            useCloudReachabilityStore.getState().reportSuccess();
            return after !== null;
          } catch (e) {
            // Transport-class failure (no HTTP status) counts toward the
            // cloud-unreachable signal; an HTTP error means the server DID
            // answer, so it does not (§19.2 / §14.7 Q9).
            const status = (e as {status?: number} | null)?.status;
            useCloudReachabilityStore
              .getState()
              .reportFailure(status === undefined);
            return false;
          }
        });
        await restoreSession();
        if (cancelled) return;
        await Promise.all([restoreCache(), initAppLock(), initDr()]);
        if (cancelled) return;
        // No Android immersive — counter cashiers need the clock + battery
        // visible at a glance, and a single swipe down briefly overlays the
        // system bars over the toolbar, which reads worse than just leaving
        // them up. iOS already keeps the bars by default.
      } catch (e) {
        // Async init failures shouldn't reach the ErrorBoundary
        // (it's render-only). Log + continue with whatever state landed.
        console.warn('[App] init failed:', e);
      }
    })();

    return () => {
      cancelled = true;
      ApiClient.setOnUnauthorized(null);
      ApiClient.setOnRefresh(null);
    };
  }, [initSettings, restoreSession, restoreCache, clearLocalSession, initAppLock, initDr]);

  // Cold-start lock — applies ONLY when the lock store finishes initialising
  // and already-has-a-PIN. Previously this fired on every `hasPin` transition,
  // which meant the moment the user finished PIN SETUP we immediately mounted
  // AppLockScreen and asked them to enter the PIN they just created — looked
  // like setup failed. Now we one-shot lock at boot if a PIN was already
  // configured pre-mount; the post-setup path stays unlocked because
  // `pinAlreadyConfiguredAtBootRef` was never flipped.
  const pinAlreadyConfiguredAtBootRef = useRef(false);
  useEffect(() => {
    if (!lockInitialized) return;
    if (pinAlreadyConfiguredAtBootRef.current) return;
    if (isAuthenticated && hasPin) {
      pinAlreadyConfiguredAtBootRef.current = true;
      lockNow();
    }
  }, [isAuthenticated, hasPin, lockNow, lockInitialized]);

  // Single AppState listener — both lock + refresh decisions share the
  // 5-second debounce so transient OS interruptions (Apple Pay sheet,
  // Control Centre, incoming call banner) don't trigger an unwanted
  // lock OR a wasted refresh round-trip. Previously there were two
  // listeners; only the lock one had the debounce, so Apple Pay would
  // fire a needless refresh request mid-checkout.
  const backgroundedAtRef = useRef<number | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background') {
        backgroundedAtRef.current = Date.now();
        return;
      }
      if (state !== 'active') return;

      const stamped = backgroundedAtRef.current;
      backgroundedAtRef.current = null;
      if (stamped == null) return;
      const backgroundedMs = Date.now() - stamped;
      if (backgroundedMs < 5_000) return; // OS interruption, not a real bg

      // Real foreground resume: lock + (if near expiry) refresh.
      lockNow();

      // Foreground after long background → if expiry is near, refresh now.
      // The setTimeout above is paused while backgrounded on iOS, so without
      // this hook a user who closes the app overnight wakes up to a stale
      // token and would hit the natural-401 path on the first tap.
      const exp = useAuthStore.getState().expiresAt;
      const authed = useAuthStore.getState().isAuthenticated;
      if (!authed || !exp) return;
      const remaining = Date.parse(exp) - Date.now();
      if (Number.isNaN(remaining)) return;
      if (remaining < 120_000) {
        useAuthStore.getState().refreshSession().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [lockNow]);

  // Configure ApiClient whenever connection-relevant settings change
  useEffect(() => {
    ApiClient.configure({
      baseUrl: settings?.baseUrl,
      relayUrl: settings?.relayUrl,
      mode: settings?.connectionMode,
      workspaceCode: settings?.workspaceCode,
    });
  }, [
    settings?.baseUrl,
    settings?.relayUrl,
    settings?.connectionMode,
    settings?.workspaceCode,
  ]);

  // Register a no-op handler for the `aeris://` URL scheme declared in
  // app.json. We don't currently route any deep links into the navigation
  // graph, but iOS will still hand us URLs the system or another app
  // generates (e.g. a malformed link from an email). Without a registered
  // handler the URL silently lands and any later assumption that
  // `Linking.getInitialURL()` returned `null` could surprise us. The
  // handler logs the URL for triage and otherwise swallows it.
  useEffect(() => {
    Linking.getInitialURL()
      .then(url => {
        if (url) console.warn('[deepLink] initial URL ignored:', url);
      })
      .catch(() => {});
    const sub = Linking.addEventListener('url', ({url}) => {
      console.warn('[deepLink] foreground URL ignored:', url);
    });
    return () => sub.remove();
  }, []);

  // Proactive Sanctum refresh: 2 minutes before expiry, mint a new token so
  // the user never sees a mid-shift "session expired" interruption. The
  // timer covers the always-foreground POS use case; the AppState listener
  // below covers the close-the-app-overnight case.
  useEffect(() => {
    if (!isAuthenticated || !expiresAt) return;
    const REFRESH_LEAD_MS = 120_000; // 2 minutes
    const msUntilRefresh = Date.parse(expiresAt) - Date.now() - REFRESH_LEAD_MS;
    if (Number.isNaN(msUntilRefresh)) {
      // Malformed ISO would silently disable refresh forever — log so the
      // server-side bug shows up in Sentry / device logs. User still falls
      // through to the natural-401 path which is acceptable.
      console.warn('[refresh] could not parse expiresAt:', expiresAt);
      return;
    }
    if (msUntilRefresh <= 0) {
      // Already past the lead — fire immediately. refreshSession handles
      // its own dedupe and error logging.
      refreshSession().catch(() => {});
      return;
    }
    const timer = setTimeout(() => {
      refreshSession().catch(() => {});
    }, msUntilRefresh);
    return () => clearTimeout(timer);
  }, [isAuthenticated, expiresAt, refreshSession]);

  // (The separate foreground-refresh AppState listener was consolidated
  // into the single backgrounded-debounce listener above so Apple Pay
  // / Control-Centre interruptions don't trigger an unnecessary refresh
  // round-trip mid-checkout.)

  // While the lock store is still resolving its async secure-store reads,
  // hide the navigator behind a navy splash so we never flash protected
  // content to a returning user before the lock overlay has a chance to
  // mount. Unauthed users skip the gate (login/setup is allowed pre-init).
  const showSplash = isAuthenticated && !lockInitialized;

  // Hold the entire tree until Poppins has loaded OR errored. The native
  // splash stays up (preventAutoHideAsync above) so the user sees the
  // brand splash instead of a blank screen. fontError lets us proceed to
  // the app rather than wedge on a black screen if the asset is bad.
  if (!fontsReady) {
    return null;
  }

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        {/* iOS: status bar hidden globally to give the navy pendant + cream
            safe-area sides a clean top edge. Android: keep the status bar
            visible — counter cashiers need to see clock/battery, and the
            immersive-then-swipe-down overlay reads worse than just leaving
            it up.
            `barStyle="dark-content"` is defensive (ignored while hidden,
            but if any future modal flips visibility, the dark text reads
            on the cream safe-area sides; white on cream would be unreadable
            per the v1.3.45 pendant SVG redesign). */}
        <StatusBar hidden={Platform.OS === 'ios'} barStyle="dark-content" />
        <NavigationContainer
          theme={{
            dark: true,
            colors: {
              primary: COLORS.accent,
              background: COLORS.background,
              card: COLORS.primary,
              text: COLORS.text,
              border: COLORS.border,
              notification: COLORS.accent,
            },
            fonts: {
              regular: { fontFamily: FONT_FAMILY.regular, fontWeight: '400' },
              medium: { fontFamily: FONT_FAMILY.medium, fontWeight: '500' },
              bold: { fontFamily: FONT_FAMILY.bold, fontWeight: '700' },
              heavy: { fontFamily: FONT_FAMILY.bold, fontWeight: '800' },
            },
          }}
        >
          <RootNavigator />
        </NavigationContainer>
        {showSplash && <View style={styles.splash} pointerEvents="auto" />}
        {isAuthenticated && lockInitialized && !hasPin && (
          <View style={styles.overlay} pointerEvents="auto">
            <PinSetupScreen />
          </View>
        )}
        {isAuthenticated && lockInitialized && hasPin && isLocked && (
          <View style={styles.overlay} pointerEvents="auto">
            <AppLockScreen />
          </View>
        )}
      </SafeAreaProvider>
    </ErrorBoundary>
  );
};

const styles = StyleSheet.create({
  splash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.navy,
  },
  // PIN setup / app-lock are full-screen overlays. Without absolute fill
  // they share layout space with the NavigationContainer below and the
  // dashboard bleeds through.
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});

export default App;
