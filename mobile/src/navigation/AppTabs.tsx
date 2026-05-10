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
import {useCartStore} from '../stores/cartStore';
import {getItemCount} from '@aeris/shared';
import {COLORS, BORDER_RADIUS, SPACING, FONT_SIZE} from '../constants/theme';
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
  // Sum line quantities so the badge matches what QuickSale + Cart show
  // (5 of one SKU is "5", not "1"). Selector returns a primitive so
  // zustand's referential-equality bail-out still fires on no-op updates.
  const cartCount = useCartStore(s => getItemCount(s.items));

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
          tabBarStyle: styles.tabBar,
          // Active tab renders a solid crimson pill (mirrors desktop's
          // .aeris-nav-active) — enabled by tabBarActiveBackgroundColor +
          // a per-item style that adds the rounded inset.
          tabBarActiveTintColor: COLORS.cream,
          tabBarActiveBackgroundColor: COLORS.crimson,
          tabBarInactiveTintColor: COLORS.textDim,
          tabBarInactiveBackgroundColor: 'transparent',
          tabBarItemStyle: styles.tabBarItem,
          tabBarLabelStyle: styles.tabBarLabel,
          tabBarBadgeStyle: styles.tabBarBadge,
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
            tabBarBadge:
              cartCount === 0
                ? undefined
                : cartCount > 99
                  ? '99+'
                  : String(cartCount),
            // Announce the actual count (not the "99+" display string) so
            // VoiceOver users hear the real number when the cart overflows.
            // When the cart is empty we fall back to the default tab label.
            tabBarAccessibilityLabel:
              cartCount > 0
                ? `Sale tab, ${cartCount} ${cartCount === 1 ? 'item' : 'items'} in cart`
                : undefined,
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
  tabBar: {
    backgroundColor: COLORS.primary,
    borderTopColor: COLORS.border,
  },
  // Active tab fills its cell edge-to-edge so the crimson background
  // reads as a deliberate state change, not an inset chip floating in
  // the bar. Drop margins entirely; keep a small radius for crispness.
  tabBarItem: {
    borderRadius: 4,
  },
  tabBarLabel: {
    fontSize: FONT_SIZE.xs,
    fontWeight: '600',
  },
  tabBarBadge: {
    backgroundColor: COLORS.cream,
    color: COLORS.crimson,
    fontSize: FONT_SIZE.xs,
    fontWeight: '700',
    minWidth: 18,
    height: 18,
    lineHeight: 18,
    // paddingHorizontal lets 2- and 3-char strings ("99+") expand the pill
    // rather than clip; minWidth (no fixed width) keeps the empty pill round.
    paddingHorizontal: 4,
  },
});

export default AppTabs;
