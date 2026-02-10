import React, {useState, useEffect, useCallback} from 'react';
import {View, StyleSheet, BackHandler, Alert, Platform} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import type {WebViewNavigation} from 'react-native-webview';
import Toolbar from '../components/Toolbar';
import WebViewContainer from '../components/WebViewContainer';
import LoadingOverlay from '../components/LoadingOverlay';
import OfflineBanner from '../components/OfflineBanner';
import PinPad from '../components/PinPad';
import SettingsModal from './SettingsModal';
import SessionSwitcherModal from './SessionSwitcherModal';
import SessionCreateModal from './SessionCreateModal';
import {useSettings} from '../hooks/useSettings';
import {useWebView} from '../hooks/useWebView';
import {useNetworkStatus} from '../hooks/useNetworkStatus';
import {useSessionTimeout} from '../hooks/useSessionTimeout';
import {useSessionStore} from '../stores/sessionStore';
import ConnectionService from '../services/ConnectionService';
import PrintService from '../services/PrintService';

const MainScreen: React.FC = () => {
  const {settings} = useSettings();
  const webView = useWebView();
  const networkStatus = useNetworkStatus(settings.baseUrl);
  const {activeSession, init, lockSession, unlockSession} = useSessionStore();

  const [settingsVisible, setSettingsVisible] = useState(false);
  const [sessionsVisible, setSessionsVisible] = useState(false);
  const [createSessionVisible, setCreateSessionVisible] = useState(false);
  const [lockOverlay, setLockOverlay] = useState(false);
  const [pinError, setPinError] = useState('');
  const [backPressCount, setBackPressCount] = useState(0);

  const {resetTimeout} = useSessionTimeout(settings.sessionTimeout);

  useEffect(() => {
    init();
  }, [init]);

  // Show lock overlay when active session is locked
  useEffect(() => {
    if (activeSession?.isLocked) {
      setLockOverlay(true);
    }
  }, [activeSession?.isLocked]);

  // Hardware back button (Android)
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (settingsVisible) {
        setSettingsVisible(false);
        return true;
      }
      if (sessionsVisible) {
        setSessionsVisible(false);
        return true;
      }
      if (createSessionVisible) {
        setCreateSessionVisible(false);
        return true;
      }
      if (lockOverlay) return true; // Block when locked
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
      return false; // Exit app
    });

    return () => handler.remove();
  }, [settingsVisible, sessionsVisible, createSessionVisible, lockOverlay, webView.canGoBack, backPressCount, webView]);

  const handleNavChange = useCallback(
    (nav: WebViewNavigation) => {
      webView.setCanGoBack(nav.canGoBack);
      webView.setCanGoForward(nav.canGoForward);
      webView.setCurrentUrl(nav.url);
      // Dismiss loading overlay when navigation reports page finished loading
      if (!nav.loading) {
        webView.setIsLoading(false);
        ConnectionService.setReachable(true);
      }
      resetTimeout(); // Reset session timer on navigation activity
      if (activeSession) {
        useSessionStore.getState().updateSessionUrl(activeSession.id, nav.url);
      }
    },
    [activeSession, webView, resetTimeout],
  );

  const handleLock = useCallback(() => {
    if (activeSession) {
      lockSession(activeSession.id);
    }
  }, [activeSession, lockSession]);

  const handleUnlock = useCallback(
    (pin: string) => {
      if (!activeSession) return;
      try {
        unlockSession(activeSession.id, pin);
        setLockOverlay(false);
        setPinError('');
      } catch (e: unknown) {
        setPinError(e instanceof Error ? e.message : 'Invalid PIN');
      }
    },
    [activeSession, unlockSession],
  );

  const handlePrint = useCallback(() => {
    PrintService.printUrl(webView.currentUrl || settings.baseUrl);
  }, [webView.currentUrl, settings.baseUrl]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Toolbar
        canGoBack={webView.canGoBack}
        canGoForward={webView.canGoForward}
        onBack={webView.goBack}
        onForward={webView.goForward}
        onReload={webView.reload}
        onHome={() => webView.webViewRef.current?.injectJavaScript(`window.location.href=${JSON.stringify(settings.baseUrl)};true;`)}
        onPrint={handlePrint}
        onLock={handleLock}
        onSettings={() => setSettingsVisible(true)}
        onSessions={() => setSessionsVisible(true)}
        showSessionButton={settings.enableSessionManagement}
        activeSessionName={activeSession?.name}
      />

      <OfflineBanner
        isConnected={networkStatus.isConnected}
        isServerReachable={networkStatus.isServerReachable}
        onRetry={() => ConnectionService.checkServer()}
      />

      <View style={styles.webviewContainer}>
        <WebViewContainer
          url={activeSession?.currentUrl || settings.baseUrl}
          webViewRef={webView.webViewRef}
          onNavigationStateChange={handleNavChange}
          onLoadStart={() => webView.setIsLoading(true)}
          onLoadEnd={() => {
            webView.setIsLoading(false);
            ConnectionService.setReachable(true);
          }}
          onError={() => {
            webView.setIsLoading(false);
            Alert.alert('Error', 'Failed to load page. Check your connection.');
          }}
        />
        <LoadingOverlay visible={webView.isLoading} />
      </View>

      {/* Lock overlay */}
      {lockOverlay && (
        <View style={styles.lockOverlay}>
          <PinPad
            title={`Unlock ${activeSession?.name || 'Session'}`}
            onSubmit={handleUnlock}
            onCancel={() => setSessionsVisible(true)}
            error={pinError}
          />
        </View>
      )}

      <SettingsModal visible={settingsVisible} onClose={() => setSettingsVisible(false)} />
      <SessionSwitcherModal
        visible={sessionsVisible}
        onClose={() => setSessionsVisible(false)}
        onCreateNew={() => {
          setSessionsVisible(false);
          setCreateSessionVisible(true);
        }}
      />
      <SessionCreateModal
        visible={createSessionVisible}
        onClose={() => setCreateSessionVisible(false)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#003049'},
  webviewContainer: {flex: 1, position: 'relative'},
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 48, 73, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
});

export default MainScreen;
