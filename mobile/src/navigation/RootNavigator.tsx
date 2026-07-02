import React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import type {LinkingOptions} from '@react-navigation/native';
import {useAuthStore} from '../stores/authStore';
import {useSettingsStore} from '../stores/settingsStore';
import AuthStack from './AuthStack';
import AppTabs from './AppTabs';
import type {RootStackParamList} from '../types/navigation.types';

const Stack = createNativeStackNavigator<RootStackParamList>();

// Deep-link config for the `aeris://` scheme declared in app.json.
//
// T4: wire the Repairs deep-link entry so `aeris://repairs`,
// `aeris://repairs/:id`, and `aeris://repairs/:id/status` resolve to the
// correct RepairsStack screen. The RepairsStack is registered on
// AppTabParamList unconditionally (see navigation.types.ts) so this
// mapping remains valid even when the Repairs *tab* is hidden — the
// safety bounce for `repairs_enabled === false` lives in
// RepairsListScreen (T5).
//
// Note: App.tsx currently installs a no-op `Linking.addEventListener`
// handler that logs and swallows URLs — this `linking` config is passed
// to `NavigationContainer` via App.tsx once linking is enabled at the
// container level. Registering the mapping here keeps the shape in one
// place and lets subsequent tasks flip a single switch to turn deep
// links on.
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['aeris://'],
  config: {
    screens: {
      App: {
        screens: {
          Tabs: {
            screens: {
              Repairs: {
                screens: {
                  RepairsList: 'repairs',
                  RepairDetail: 'repairs/:id',
                  RepairStatusChange: 'repairs/:id/status',
                },
              },
            },
          },
        },
      },
    },
  },
};

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
