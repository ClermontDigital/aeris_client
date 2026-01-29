import {useRef, useState, useCallback} from 'react';
import type WebView from 'react-native-webview';

export function useWebView() {
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [currentUrl, setCurrentUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const goBack = useCallback(() => webViewRef.current?.goBack(), []);
  const goForward = useCallback(() => webViewRef.current?.goForward(), []);
  const reload = useCallback(() => webViewRef.current?.reload(), []);

  const injectJavaScript = useCallback((script: string) => {
    webViewRef.current?.injectJavaScript(script);
  }, []);

  return {
    webViewRef,
    canGoBack,
    setCanGoBack,
    canGoForward,
    setCanGoForward,
    currentUrl,
    setCurrentUrl,
    isLoading,
    setIsLoading,
    goBack,
    goForward,
    reload,
    injectJavaScript,
  };
}
