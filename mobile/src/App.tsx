import React, {useEffect} from 'react';
import {AppState, StatusBar, Platform, View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import type {AppStateStatus} from 'react-native';
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
  const markBackgrounded = useAuthStore(s => s.markBackgrounded);
  const evaluateBackgroundLock = useAuthStore(s => s.evaluateBackgroundLock);
  const restoreCache = useProductCacheStore(s => s.restoreCache);

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

  // Auto-lock the auth session when the app has been in the background for
  // more than BACKGROUND_LOCK_MS. iOS does not let an app terminate itself,
  // so the equivalent UX is: stamp Date.now() on background, on resume drop
  // the session if the gap exceeds the threshold and route the user back to
  // LoginScreen. Cold-boot path (iOS killed the suspended app) is also
  // covered inside restoreSession() reading the same persisted stamp.
  useEffect(() => {
    const handleAppStateChange = (state: AppStateStatus) => {
      if (state === 'background') {
        markBackgrounded();
      } else if (state === 'active') {
        evaluateBackgroundLock();
      }
      // 'inactive' is a transient iOS state (e.g. control-center pull-down)
      // and does not constitute backgrounding. Ignore it.
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [markBackgrounded, evaluateBackgroundLock]);

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
