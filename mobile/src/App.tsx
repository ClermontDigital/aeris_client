import React, {useEffect} from 'react';
import {StatusBar, Platform, View, Text, StyleSheet, TouchableOpacity, LogBox} from 'react-native';

LogBox.ignoreLogs(['new NativeEventEmitter']);
import {SafeAreaProvider} from 'react-native-safe-area-context';
import KeepAwake from 'react-native-keep-awake';
import {Immersive} from 'react-native-immersive';
import {useSettingsStore} from './stores/settingsStore';
import MainScreen from './screens/MainScreen';

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

  useEffect(() => {
    KeepAwake.activate();
    initSettings();

    if (Platform.OS === 'android') {
      StatusBar.setHidden(true);
      Immersive.on();
    }
  }, [initSettings]);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar hidden />
        <MainScreen />
      </SafeAreaProvider>
    </ErrorBoundary>
  );
};

export default App;
