import React, {useState} from 'react';
import {View, Image, StyleSheet, TouchableOpacity} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {Ionicons} from '@expo/vector-icons';
import DashboardScreen from '../screens/DashboardScreen';
import QuickSaleStack from './QuickSaleStack';
import ItemsStack from './ItemsStack';
import CustomersStack from './CustomersStack';
import TransactionsStack from './TransactionsStack';
import ERPScreen from '../screens/ERPScreen';
import SettingsModal from '../screens/SettingsModal';
import {useSettingsStore} from '../stores/settingsStore';
import {useNetworkStatus} from '../hooks/useNetworkStatus';
import {useHaptics} from '../hooks/useHaptics';
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
  const haptics = useHaptics();
  const [settingsVisible, setSettingsVisible] = useState(false);

  return (
    <View style={styles.root}>
      {/* Navy strip across the device's top safe-area inset (status bar /
          dynamic island row). Mirrors the navy logo bar on the Aeris2 web
          app and the navy chrome on the Electron desktop client so all
          three surfaces read as one product. The screens below render with
          their own cream SafeAreaView; the top inset is consumed here so
          they don't double-pad. */}
      <SafeAreaView edges={['top']} style={styles.topBar}>
        <View style={styles.topBarRow}>
          <Image
            source={require('../../assets/images/app-icon.png')}
            style={styles.brandLogo}
            accessibilityIgnoresInvertColors
            accessibilityLabel="Aeris"
            resizeMode="contain"
          />
          <TouchableOpacity
            onPress={() => {
              haptics.light();
              setSettingsVisible(true);
            }}
            style={styles.gearBtn}
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
            <Ionicons name="settings-outline" size={22} color={COLORS.cream} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
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
        name="Items"
        component={ItemsStack}
        options={{
          tabBarIcon: ({color, size}) => (
            <Ionicons name="cube" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Customers"
        component={CustomersStack}
        options={{
          tabBarIcon: ({color, size}) => (
            <Ionicons name="people" size={size} color={color} />
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
      <SettingsModal
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: COLORS.navy},
  topBar: {backgroundColor: COLORS.navy},
  // Logo is centered by absolute-positioning across the row; the gear sits on
  // top in the trailing corner so the logo stays visually centred regardless
  // of locale label widths.
  topBarRow: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandLogo: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  gearBtn: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default AppTabs;
