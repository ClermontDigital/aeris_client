import React, {useState, useEffect, useCallback} from 'react';
import {View, StyleSheet, BackHandler, Platform} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useFocusEffect} from '@react-navigation/native';
import type {WebViewNavigation} from 'react-native-webview';
import Toolbar from '../components/Toolbar';
import WebViewContainer from '../components/WebViewContainer';
import LoadingOverlay from '../components/LoadingOverlay';
import OfflineBanner from '../components/OfflineBanner';
import EmptyState from '../components/EmptyState';
import SettingsModal from './SettingsModal';
import {useSettingsStore} from '../stores/settingsStore';
import {useHeaderBackStore} from '../stores/headerBackStore';
import {useAuthStore} from '../stores/authStore';
import {useWebView} from '../hooks/useWebView';
import {useNetworkStatus} from '../hooks/useNetworkStatus';
import ConnectionService from '../services/ConnectionService';
import PrintService from '../services/PrintService';
import {COLORS} from '../constants/theme';

const ERPScreen: React.FC = () => {
  const baseUrl = useSettingsStore(s => s.settings.baseUrl);
  const connectionMode = useSettingsStore(s => s.settings.connectionMode);
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const webView = useWebView();
  const networkStatus = useNetworkStatus(baseUrl);

  // Tab root: null the shared brand-header back slot on focus so a
  // stale handler left over by ProductDetail / ProductEdit doesn't
  // bleed through onto the ERP webview.
  useFocusEffect(
    useCallback(() => {
      useHeaderBackStore.getState().clearOnBack();
      return undefined;
    }, []),
  );

  const [backPressCount, setBackPressCount] = useState(0);
  const [settingsVisible, setSettingsVisible] = useState(false);
  // Latched on WebViewContainer onError so direct-mode users (the only
  // path here — relay mode short-circuits to EmptyState above) see a
  // retryable fallback instead of a dead-white WebView under a dismissed
  // alert. Cleared on a manual retry which forces the WebView to remount.
  const [loadFailed, setLoadFailed] = useState(false);
  const [webViewKey, setWebViewKey] = useState(0);
  const isRelayMode = connectionMode === 'relay';

  // Hardware back button (Android)
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (webView.canGoBack) {
        webView.goBack();
        return true;
      }
      // Double-press to exit
      if (backPressCount === 0) {
        setBackPressCount(1);
        setTimeout(() => setBackPressCount(0), 2000);
        return true;
      }
      return false;
    });

    return () => handler.remove();
  }, [webView.canGoBack, backPressCount, webView]);

  const handleNavChange = useCallback(
    (nav: WebViewNavigation) => {
      webView.setCanGoBack(nav.canGoBack);
      webView.setCanGoForward(nav.canGoForward);
      webView.setCurrentUrl(nav.url);
      if (!nav.loading) {
        webView.setIsLoading(false);
        ConnectionService.setReachable(true);
      }
    },
    [webView],
  );

  const handleHome = useCallback(() => {
    webView.webViewRef.current?.injectJavaScript(
      `window.location.href=${JSON.stringify(baseUrl)};true;`,
    );
  }, [webView.webViewRef, baseUrl]);

  const handlePrint = useCallback(() => {
    // Pass baseUrl as the allowedHost — printUrl refuses to forward
    // Laravel session cookies to any host other than the configured
    // deployment, even if the WebView drifted off-host.
    PrintService.printUrl(webView.currentUrl || baseUrl, baseUrl);
  }, [webView.currentUrl, baseUrl]);

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <Toolbar
        canGoBack={webView.canGoBack}
        canGoForward={webView.canGoForward}
        onBack={webView.goBack}
        onForward={webView.goForward}
        onReload={webView.reload}
        onHome={handleHome}
        onPrint={handlePrint}
        onLock={() => {}}
        onSettings={() => setSettingsVisible(true)}
        showSessionButton={false}
      />

      {!isRelayMode && (
        <OfflineBanner
          isConnected={networkStatus.isConnected}
          isServerReachable={networkStatus.isServerReachable}
          onRetry={() => ConnectionService.checkServer()}
        />
      )}

      {isRelayMode ? (
        // ERP web shell talks to the deployment directly; in relay mode the
        // architecture forbids that, so route the user to the native tabs.
        <EmptyState
          icon="cloud-offline-outline"
          title="ERP web view unavailable"
          description="The full ERP shell is only available in direct (LAN) mode. While you are connected through the Aeris relay, please use the POS, Scanner, and Transactions tabs for day-to-day work."
        />
      ) : loadFailed ? (
        // Direct-mode load failure (e.g. aeris.local unreachable on this
        // network). Surface a native fallback with a retry CTA rather
        // than leaving the broken WebView mounted under a dismissed alert.
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't reach the AERIS server"
          description={`We weren't able to load ${baseUrl}. Check that you're on the same network as the AERIS deployment, then try again.`}
          action={{
            label: 'Retry',
            onPress: () => {
              setLoadFailed(false);
              setWebViewKey(k => k + 1);
            },
          }}
        />
      ) : (
        <View style={styles.webviewContainer}>
          <WebViewContainer
            key={webViewKey}
            url={baseUrl}
            webViewRef={webView.webViewRef}
            onNavigationStateChange={handleNavChange}
            onLoadStart={() => webView.setIsLoading(true)}
            onLoadEnd={() => {
              webView.setIsLoading(false);
              ConnectionService.setReachable(true);
            }}
            onError={() => {
              webView.setIsLoading(false);
              setLoadFailed(true);
            }}
          />
          <LoadingOverlay visible={webView.isLoading} />
        </View>
      )}

      <SettingsModal
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  webviewContainer: {
    flex: 1,
    position: 'relative',
  },
});

export default ERPScreen;
