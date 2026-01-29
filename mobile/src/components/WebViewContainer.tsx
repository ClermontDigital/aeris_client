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

    // Bridge: WebView -> RN
    window.aeris = {
      postMessage: function(type, data) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({type: type, data: data}));
        }
      }
    };
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
  let baseHost = '';
  try { baseHost = new URL(url).hostname; } catch { /* invalid URL */ }

  const shouldStartLoad = (request: ShouldStartLoadRequest): boolean => {
    let requestHost = '';
    try { requestHost = new URL(request.url).hostname; } catch { return true; }
    if (requestHost === baseHost) return true;

    // Open external links in system browser
    Linking.openURL(request.url);
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
        onMessage={e => onMessage?.(e.nativeEvent.data)}
        injectedJavaScript={BRIDGE_JS}
        javaScriptEnabled
        domStorageEnabled
        allowsBackForwardNavigationGestures
        mixedContentMode="never"
        startInLoadingState
        pullToRefreshEnabled
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1},
  webview: {flex: 1},
});

export default WebViewContainer;
