import React, {useEffect} from 'react';
import {StatusBar, Platform} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {activateKeepAwake} from 'react-native-keep-awake';
import {Immersive} from 'react-native-immersive';
import {useSettingsStore} from './stores/settingsStore';
import MainScreen from './screens/MainScreen';

const App: React.FC = () => {
  const initSettings = useSettingsStore(s => s.init);

  useEffect(() => {
    activateKeepAwake();
    initSettings();

    if (Platform.OS === 'android') {
      StatusBar.setHidden(true);
      Immersive.on();
    }
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar hidden />
      <MainScreen />
    </SafeAreaProvider>
  );
};

export default App;
