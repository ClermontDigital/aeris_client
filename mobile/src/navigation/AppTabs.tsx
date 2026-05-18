import React, {useState} from 'react';
import {View, Image, Pressable, StyleSheet, TouchableOpacity, GestureResponderEvent} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import type {BottomTabBarButtonProps} from '@react-navigation/bottom-tabs';
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
import {COLORS, SPACING, FONT_SIZE} from '../constants/theme';
import type {AppTabParamList} from '../types/navigation.types';

const Tab = createBottomTabNavigator<AppTabParamList>();

// Custom tab button: thin crimson top stripe marks the active tab so the
// row keeps a consistent height + baseline. Replaces the prior full-cell
// crimson fill that visually overpowered inactive tabs and broke
// alignment per the screenshot feedback.
const TabButton: React.FC<BottomTabBarButtonProps> = ({
  accessibilityState,
  children,
  onPress,
  onLongPress,
  style,
  testID,
}) => {
  const focused = accessibilityState?.selected ?? false;
  return (
    <Pressable
      onPress={(e: GestureResponderEvent) => onPress?.(e)}
      onLongPress={onLongPress ?? undefined}
      accessibilityState={accessibilityState}
      testID={testID}
      style={[styles.tabBtn, style]}
      android_ripple={{color: 'rgba(193, 18, 31, 0.12)', borderless: false}}>
      <View style={[styles.indicator, focused && styles.indicatorActive]} />
      {children}
    </Pressable>
  );
};

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
      {/* Navy header with a downward-bulging navy island hosting the
          wordmark — cream "shoulders" on each side curve up into the
          navy with rounded inner corners. Net effect: the navy reads
          as a tab protruding into the cream body, framing the logo. */}
      <SafeAreaView edges={['top']} style={styles.topBar}>
        <View style={styles.topBarRow}>
          <View style={styles.bottomFlank} pointerEvents="none">
            <View style={styles.shoulderLeft} />
            <View style={styles.islandSpacer} />
            <View style={styles.shoulderRight} />
          </View>
          <Image
            source={require('../../assets/images/aeris-wordmark.png')}
            style={styles.brandWordmark}
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
          // Active tab: crimson icon + label, plus a 3-px top stripe from
          // the custom TabButton. Drops the full-cell crimson background
          // so all tabs keep an identical baseline.
          tabBarActiveTintColor: COLORS.crimson,
          tabBarInactiveTintColor: COLORS.textDim,
          tabBarLabelStyle: styles.tabBarLabel,
          tabBarBadgeStyle: styles.tabBarBadge,
          tabBarButton: (props) => <TabButton {...props} />,
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
  topBarRow: {
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Cream shoulders flanking a navy island at the bottom of the header.
  // Each shoulder's inner top corner curves up to meet the island, so
  // the navy reads as a downward-protruding tab around the wordmark.
  bottomFlank: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 32,
    flexDirection: 'row',
  },
  shoulderLeft: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderTopRightRadius: 32,
  },
  // Spacer = the navy island where the wordmark sits. Transparent so
  // the navy bar shows through. Width tuned to hug the wordmark with
  // a comfortable margin.
  islandSpacer: {
    width: 220,
  },
  shoulderRight: {
    flex: 1,
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 32,
  },
  // Native asset is 250x73 (3.42 aspect); render at 130x38 so it stays
  // crisp across phone DPIs while leaving room for the safe-area inset
  // and the gear icon on the right.
  brandWordmark: {
    width: 130,
    height: 38,
    zIndex: 1,
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
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Transparent placeholder so all tabs share identical layout — only the
  // focused tab paints crimson, preserving the row's vertical baseline.
  indicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'transparent',
  },
  indicatorActive: {
    backgroundColor: COLORS.crimson,
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
