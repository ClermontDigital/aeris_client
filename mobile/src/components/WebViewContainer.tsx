import React from 'react';
import {View, StyleSheet} from 'react-native';
import {WebView, WebViewNavigation} from 'react-native-webview';
import type {ShouldStartLoadRequest} from 'react-native-webview/lib/WebViewTypes';
import {Linking} from 'react-native';

interface WebViewContainerProps {
  url: string;
  webViewRef: React.RefObject<WebView>;
  onNavigationStateChange: (nav: WebViewNavigation) => void;
  onLoadStart: () => void;
  onLoadEnd: () => void;
  onError: () => void;
  onMessage?: (data: string) => void;
}

const BRIDGE_JS = `
  (function() {
    if (window.__aeris_bridge_injected) return;
    window.__aeris_bridge_injected = true;

    // Fix Bootstrap modal focus
    document.addEventListener('shown.bs.modal', function(e) {
      var modal = e.target;
      if (modal) {
        var focusable = modal.querySelector('input, select, textarea, button');
        if (focusable) focusable.focus();
      }
    });

    // Extract CSRF token from Laravel meta tag and expose for bridge use
    function getCsrfToken() {
      var meta = document.querySelector('meta[name="csrf-token"]');
      return meta ? meta.getAttribute('content') : null;
    }

    // Bridge: WebView -> RN
    window.aeris = {
      postMessage: function(type, data) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({type: type, data: data}));
        }
      },
      getCsrfToken: getCsrfToken
    };

    // Notify RN when CSRF token is available (after Laravel page load)
    var token = getCsrfToken();
    if (token && window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'csrf-token',
        data: { token: token }
      }));
    }

    // Handle 419 CSRF token expiry by reloading to get a fresh token
    if (document.title === '419' || document.body.innerText.indexOf('PAGE EXPIRED') !== -1) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'csrf-expired'
      }));
    }

    true;
  })();
`;

const WebViewContainer: React.FC<WebViewContainerProps> = ({
  url,
  webViewRef,
  onNavigationStateChange,
  onLoadStart,
  onLoadEnd,
  onError,
  onMessage,
}) => {
  // Hosts that are all equivalent to localhost (emulator aliases, loopback)
  const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '10.0.2.2']);

  let baseHost = '';
  try { baseHost = new URL(url).hostname; } catch { /* invalid URL */ }

  const hostsMatch = (a: string, b: string): boolean => {
    if (a === b) return true;
    return LOOPBACK_HOSTS.has(a) && LOOPBACK_HOSTS.has(b);
  };

  const shouldStartLoad = (request: ShouldStartLoadRequest): boolean => {
    // Block dangerous URI schemes (data:, javascript:, file:, blob:, etc.)
    let scheme: string;
    try {
      scheme = new URL(request.url).protocol.replace(':', '').toLowerCase();
    } catch {
      // Fallback for malformed URLs
      scheme = request.url.split(':')[0]?.toLowerCase() ?? '';
    }
    if (!scheme || !['http', 'https'].includes(scheme)) return false;

    // If baseHost could not be parsed, allow all http/https navigation
    // to prevent the WebView from being completely non-functional
    if (!baseHost) return true;

    let requestHost = '';
    try { requestHost = new URL(request.url).hostname; } catch { return false; }
    if (hostsMatch(requestHost, baseHost)) return true;

    // Open external links in system browser
    try { Linking.openURL(request.url); } catch { /* ignore malformed URL */ }
    return false;
  };

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{uri: url}}
        style={styles.webview}
        onNavigationStateChange={onNavigationStateChange}
        onLoadStart={onLoadStart}
        onLoadEnd={onLoadEnd}
        onError={onError}
        onShouldStartLoadWithRequest={shouldStartLoad}
        onMessage={e => {
          try {
            const msg = JSON.parse(e.nativeEvent.data);
            if (msg.type === 'csrf-expired' && webViewRef.current) {
              webViewRef.current.reload();
              return;
            }
          } catch { /* not JSON, pass through */ }
          onMessage?.(e.nativeEvent.data);
        }}
        injectedJavaScript={BRIDGE_JS}
        javaScriptEnabled
        domStorageEnabled
        allowsBackForwardNavigationGestures
        mixedContentMode="never"
        startInLoadingState
        pullToRefreshEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1},
  webview: {flex: 1},
});

export default WebViewContainer;
