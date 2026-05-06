import React, {useEffect} from 'react';
import {StatusBar, Platform, View, Text, StyleSheet, TouchableOpacity, AppState} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NavigationContainer} from '@react-navigation/native';
import {activateKeepAwakeAsync} from 'expo-keep-awake';
import * as NavigationBar from 'expo-navigation-bar';
import {useSettingsStore} from './stores/settingsStore';
import {useAuthStore} from './stores/authStore';
import {useProductCacheStore} from './stores/productCacheStore';
import ApiClient from './services/ApiClient';
import RootNavigator from './navigation/RootNavigator';
import {COLORS} from './constants/theme';

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
  container: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#003049', padding: 24},
  title: {fontSize: 22, fontWeight: '700', color: '#dc2626', marginBottom: 12},
  message: {fontSize: 14, color: '#e2e8f0', textAlign: 'center', marginBottom: 24},
  button: {backgroundColor: '#667eea', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8},
  buttonText: {color: '#fff', fontSize: 16, fontWeight: '600'},
});

const App: React.FC = () => {
  const initSettings = useSettingsStore(s => s.init);
  const settings = useSettingsStore(s => s.settings);
  const restoreSession = useAuthStore(s => s.restoreSession);
  const clearLocalSession = useAuthStore(s => s.clearLocalSession);
  const restoreCache = useProductCacheStore(s => s.restoreCache);
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const expiresAt = useAuthStore(s => s.expiresAt);
  const refreshSession = useAuthStore(s => s.refreshSession);

  useEffect(() => {
    activateKeepAwakeAsync();
    initSettings();
    restoreSession();
    restoreCache();

    // Wire 401s in ApiClient back into the auth store so a stale token
    // takes the user to the login screen instead of leaving them logged-in
    // but unable to make any calls.
    ApiClient.setOnUnauthorized(() => {
      clearLocalSession();
    });

    if (Platform.OS === 'android') {
      StatusBar.setHidden(true);
      NavigationBar.setVisibilityAsync('hidden');
    }

    return () => {
      ApiClient.setOnUnauthorized(null);
    };
  }, [initSettings, restoreSession, restoreCache, clearLocalSession]);

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

  // Proactive Sanctum refresh: 2 minutes before expiry, mint a new token so
  // the user never sees a mid-shift "session expired" interruption. The
  // timer covers the always-foreground POS use case; the AppState listener
  // below covers the close-the-app-overnight case.
  useEffect(() => {
    if (!isAuthenticated || !expiresAt) return;
    const REFRESH_LEAD_MS = 120_000; // 2 minutes
    const msUntilRefresh = Date.parse(expiresAt) - Date.now() - REFRESH_LEAD_MS;
    if (Number.isNaN(msUntilRefresh)) return;
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

  // Foreground after long background → if expiry is near, refresh now.
  // The setTimeout above is paused while backgrounded on iOS, so without
  // this hook a user who closes the app overnight wakes up to a stale
  // token and would hit the natural-401 path on the first tap.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      if (!isAuthenticated || !expiresAt) return;
      const remaining = Date.parse(expiresAt) - Date.now();
      if (Number.isNaN(remaining)) return;
      if (remaining < 120_000) {
        refreshSession().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [isAuthenticated, expiresAt, refreshSession]);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar hidden />
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
              regular: { fontFamily: 'System', fontWeight: '400' },
              medium: { fontFamily: 'System', fontWeight: '500' },
              bold: { fontFamily: 'System', fontWeight: '700' },
              heavy: { fontFamily: 'System', fontWeight: '800' },
            },
          }}
        >
          <RootNavigator />
        </NavigationContainer>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
};

export default App;
