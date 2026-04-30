import React from 'react';
import {View, StyleSheet} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {Ionicons} from '@expo/vector-icons';
import DashboardScreen from '../screens/DashboardScreen';
import QuickSaleStack from './QuickSaleStack';
import BarcodeScannerScreen from '../screens/BarcodeScannerScreen';
import TransactionsStack from './TransactionsStack';
import ERPScreen from '../screens/ERPScreen';
import {useSettingsStore} from '../stores/settingsStore';
import {useNetworkStatus} from '../hooks/useNetworkStatus';
import {COLORS} from '../constants/theme';
import type {AppTabParamList} from '../types/navigation.types';

const Tab = createBottomTabNavigator<AppTabParamList>();

const AppTabs: React.FC = () => {
  const connectionMode = useSettingsStore(s => s.settings.connectionMode);
  const baseUrl = useSettingsStore(s => s.settings.baseUrl);
  // The AERIS tab embeds the deployment's web UI directly in a WebView.
  // In relay mode the device shouldn't reach the deployment per the
  // architecture, so the tab is only useful when we happen to be on the
  // deployment's network. Hide it otherwise — saves the user a confusing
  // NSURLErrorDomain -1004 if they tap it expecting the tab to work.
  const {isServerReachable} = useNetworkStatus(baseUrl);
  const showErpTab = connectionMode !== 'relay' || isServerReachable;

  return (
    <View style={styles.root}>
      {/* Navy strip across the device's top safe-area inset (status bar /
          dynamic island row). Mirrors the navy logo bar on the Aeris2 web
          app and the navy chrome on the Electron desktop client so all
          three surfaces read as one product. The screens below render with
          their own cream SafeAreaView; the top inset is consumed here so
          they don't double-pad. */}
      <SafeAreaView edges={['top']} style={styles.topBar} />
      <Tab.Navigator
      initialRouteName="Dashboard"
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: COLORS.primary,
          borderTopColor: COLORS.border,
        },
        tabBarActiveTintColor: COLORS.accent,
        tabBarInactiveTintColor: COLORS.textDim,
      }}>
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarIcon: ({color, size}) => (
            <Ionicons name="stats-chart" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="QuickSale"
        component={QuickSaleStack}
        options={{
          tabBarLabel: 'Sale',
          tabBarIcon: ({color, size}) => (
            <Ionicons name="cart" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Scanner"
        component={BarcodeScannerScreen}
        options={{
          tabBarIcon: ({color, size}) => (
            <Ionicons name="barcode" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Transactions"
        component={TransactionsStack}
        options={{
          tabBarIcon: ({color, size}) => (
            <Ionicons name="receipt" size={size} color={color} />
          ),
        }}
      />
      {showErpTab && (
        <Tab.Screen
          name="ERP"
          component={ERPScreen}
          options={{
            tabBarLabel: 'Aeris',
            tabBarIcon: ({color, size}) => (
              <Ionicons name="globe" size={size} color={color} />
            ),
          }}
        />
      )}
      </Tab.Navigator>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: COLORS.navy},
  topBar: {backgroundColor: COLORS.navy},
});

export default AppTabs;
