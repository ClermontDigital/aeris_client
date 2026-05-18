import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {useAuthStore} from '../stores/authStore';
import {useSettingsStore} from '../stores/settingsStore';
import AuthStack from './AuthStack';
import AppTabs from './AppTabs';
import type {RootStackParamList} from '../types/navigation.types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const RootNavigator: React.FC = () => {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const isLoading = useAuthStore(s => s.isLoading);
  // Hold the splash until settings have hydrated too. Otherwise a fast user
  // can reach LoginScreen and tap Sign In before the settings-driven
  // ApiClient.configure() useEffect in App.tsx has applied workspaceCode,
  // producing a 401 "missing both creds" on the first attempt.
  const settingsLoading = useSettingsStore(s => s.isLoading);

  if (isLoading || settingsLoading) return null; // Splash screen handles this

  return (
    <Stack.Navigator screenOptions={{headerShown: false, animation: 'fade'}}>
      {isAuthenticated ? (
        <Stack.Screen name="App" component={AppTabs} />
      ) : (
        <Stack.Screen name="Auth" component={AuthStack} />
      )}
    </Stack.Navigator>
  );
};

export default RootNavigator;
