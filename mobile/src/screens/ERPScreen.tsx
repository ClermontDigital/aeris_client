import React, {useState, useEffect, useCallback} from 'react';
import {View, StyleSheet, BackHandler, Alert, Platform} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import type {WebViewNavigation} from 'react-native-webview';
import Toolbar from '../components/Toolbar';
import WebViewContainer from '../components/WebViewContainer';
import LoadingOverlay from '../components/LoadingOverlay';
import OfflineBanner from '../components/OfflineBanner';
import EmptyState from '../components/EmptyState';
import SettingsModal from './SettingsModal';
import {useSettingsStore} from '../stores/settingsStore';
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

  const [backPressCount, setBackPressCount] = useState(0);
  const [settingsVisible, setSettingsVisible] = useState(false);
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
      ) : (
        <View style={styles.webviewContainer}>
          <WebViewContainer
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
              Alert.alert(
                'Error',
                'Failed to load page. Check your connection.',
              );
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
