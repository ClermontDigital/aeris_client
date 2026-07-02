import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  GestureResponderEvent,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {useNavigation, StackActions} from '@react-navigation/native';
import type {BottomTabBarButtonProps} from '@react-navigation/bottom-tabs';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import Icon from '../components/Icon';
import {ModeIndicator} from '../components/ModeIndicator';
import {FailoverBanners} from '../components/FailoverBanners';
import {BrandHeaderChrome} from '../components/BrandHeaderChrome';
import DashboardScreen from '../screens/DashboardScreen';
import QuickSaleStack from './QuickSaleStack';
import ItemsStack from './ItemsStack';
import CustomersStack from './CustomersStack';
import RepairsStack from './RepairsStack';
import TransactionsStack from './TransactionsStack';
import ERPScreen from '../screens/ERPScreen';
import {SettingsScreen} from '../screens/SettingsModal';
import {useSettingsStore} from '../stores/settingsStore';
import {useWorkspaceFeaturesStore} from '../stores/workspaceFeaturesStore';
import {useNetworkStatus} from '../hooks/useNetworkStatus';
import {useHaptics} from '../hooks/useHaptics';
import {useResponsiveLayout} from '../hooks/useResponsiveLayout';
import {useCartStore} from '../stores/cartStore';
import {useNavHistoryStore} from '../stores/navHistoryStore';
import {useScannerVisibilityStore} from '../stores/scannerVisibilityStore';
import {useHeaderBackStore} from '../stores/headerBackStore';
import {getItemCount} from '@aeris/shared';
import {COLORS, FONT_SIZE, FONT_FAMILY} from '../constants/theme';
import type {AppTabParamList, AppStackParamList} from '../types/navigation.types';

const Tab = createBottomTabNavigator<AppTabParamList>();

// Custom tab button: thin crimson top stripe marks the active tab so the
// row keeps a consistent height + baseline.
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
      onPress={(e: GestureResponderEvent) => {
        // Bottom-nav tap is the "I'm done exploring, give me a fresh
        // start" signal. Wipe the cross-tab breadcrumb history so the
        // next deep journey starts clean — without this, a user who
        // walked through several detail screens then tapped Items would
        // still see stale breadcrumbs influencing later back buttons.
        useNavHistoryStore.getState().reset();
        onPress?.(e);
      }}
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

// Pendant-shaped tongue: wide shoulders at the top where the wordmark
// sits, tapering narrower toward the rounded bottom. Each cream cutout
// is bounded on its inside edge by a quadratic Bézier with HORIZONTAL
// tangent at the top (joins the flat chrome edge with no 90° corner)
// and VERTICAL tangent at the bottom (joins the straight tongue side
// with no 90° corner). Both tangents are forced by placing the single
// quadratic control point at the intersection of the chrome edge and
// the tongue side.
// Brand-header chrome constants (BAND_TOP, BAND_H, TONGUE_*) moved to
// BrandHeaderChrome.tsx. AppTabs's absolute overlays (gear, back, mode
// chip) anchor at `insets.top + 36` — the same offset as before, since
// BrandHeaderChrome keeps BAND_TOP=30 and the +36 sits 6 px below the
// band's top edge.

// "Pop to root" when a focused tab is re-tapped. React Navigation v7
// bottom-tabs DOES NOT do this by default — pressing the focused tab
// is a no-op unless you intercept tabPress. Without this listener, a
// user who drilled into ItemsList → ProductDetail → CustomerDetail then
// taps Items expecting "take me back to the list" stays stuck on the
// detail screen. Also resets the cross-tab breadcrumb history so the
// next deep journey starts clean (a bottom-nav tap is the universal
// "I'm done exploring, fresh start" signal).
// Typed as `any` for the Tab.Screen `listeners` prop — React Navigation's
// `EventListenerCallback` generics depend on the tab's specific route
// name, so a single shared helper can't satisfy four call sites without
// resorting to `any`. Functionality and runtime types are correct.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const popToRootOnReTap: any = ({navigation}: any) => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tabPress: (_e: any) => {
    if (navigation.isFocused()) {
      // popToTop walks the inner stack back to its initialRouteName
      // screen. If we're already at root it's a cheap no-op.
      navigation.dispatch(StackActions.popToTop());
      useNavHistoryStore.getState().reset();
    } else {
      // Different tab → switching tabs counts as a fresh exploration.
      useNavHistoryStore.getState().reset();
    }
  },
});

// Inner tab navigator — the actual bottom-tab UI plus the brand chrome
// (pendant + wordmark + gear). This used to be the file's default
// export; it's now wrapped by `AppTabs` (a native-stack) so the gear
// can push the Settings page as a proper screen with native back chrome
// instead of opening a modal overlay.
const AppTabsInner: React.FC = () => {
  const connectionMode = useSettingsStore(s => s.settings.connectionMode);
  const baseUrl = useSettingsStore(s => s.settings.baseUrl);
  const {isServerReachable} = useNetworkStatus(baseUrl);
  // ERP tab embeds the merchant's own self-hosted admin web UI in a
  // WebView. Build-time gated by EXPO_PUBLIC_SHOW_ERP_TAB (absent or
  // "false" hides it). Apple Guideline 2.5.6 / 4.2 flag web-view-heavy
  // surfaces on App Store builds, so production EAS profiles leave
  // this unset; on-prem self-hosters and internal dev builds opt in.
  // When opted-in, we still require Direct mode + a reachable server
  // before the tab renders, so a stale flag in a relay-only build
  // can't surface a broken WebView.
  const erpTabEnabled =
    process.env.EXPO_PUBLIC_SHOW_ERP_TAB === 'true' ||
    process.env.EXPO_PUBLIC_SHOW_ERP_TAB === '1';
  const showErpTab =
    erpTabEnabled && (connectionMode !== 'relay' || isServerReachable);
  // Repairs tab is workspace-scoped: surfaced only when the merchant's
  // workspace has `repairs_enabled: true` in its features payload (see
  // workspaceFeaturesStore.hydrateFromLogin). The RepairsStack itself is
  // ALWAYS registered on the AppTab param list — only the visible tab is
  // gated — so an admin who toggles the flag mid-session doesn't need a
  // nav rebuild for cross-tab navigate() or deep-link resolution.
  const showRepairsTab = useWorkspaceFeaturesStore(s => s.repairs_enabled);
  const haptics = useHaptics();
  const insets = useSafeAreaInsets();
  // React Navigation's bottom-tabs defaults to ~56dp on Android, which
  // reads as a thin strip on a 10" Samsung Tab. Bump to 80dp content
  // (+ safe-area inset) on regular/wide form factors so the bar visually
  // balances the rest of the chrome. Phones keep the default.
  const {isTablet} = useResponsiveLayout();
  // Gear icon now navigates to the AppStack's Settings route on the
  // parent navigator instead of opening a local modal. getParent() is
  // typed as the AppStack so navigate('Settings') is checked.
  const stackNav =
    useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const cartCount = useCartStore(s => getItemCount(s.items));
  // Hide the pendant + gear when the Scanner screen is focused.
  // Reading via a Zustand store rather than useNavigationState because
  // AppTabsInner is rendered inside the parent AppStack — useNavigationState
  // would resolve to AppStack's state (just [Tabs, Settings]) and never
  // see the Scanner route nested inside Items/QuickSale stacks. The
  // Scanner screen itself flips this store on focus/blur via useFocusEffect.
  const isOnScanner = useScannerVisibilityStore(s => s.isScannerVisible);
  // Optional left-side back affordance: a drill-down screen (e.g. item
  // detail/edit) registers its own goBack handler on focus; we render the
  // button only when one is set so it never appears on tab roots.
  const headerOnBack = useHeaderBackStore(s => s.onBack);

  return (
    <View style={styles.root}>
      {isOnScanner ? null : (
        <BrandHeaderChrome>
          {/* §19.3 mode indicator — right-anchored, just inboard of the gear,
              so it clusters with the gear instead of crowding the wordmark.
              Suppressed only while Scanner is focused, mirroring the gear. */}
          <ModeIndicator topOffset={insets.top + 36} />
          {/* §14.7 Q9 + §17.4 DR banners — thin, non-blocking, under the
              tongue so they sit on every screen without their own chrome. */}
          <FailoverBanners />
        </BrandHeaderChrome>
      )}
      {isOnScanner || !headerOnBack ? null : (
        <TouchableOpacity
          onPress={() => {
            haptics.light();
            // Re-read at press time so a stale closure can't fire the wrong
            // screen's handler if the store changed between render and tap.
            useHeaderBackStore.getState().onBack?.();
          }}
          style={[styles.backBtnHeader, {top: insets.top + 36}]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Icon name="chevron-back" size={22} color={COLORS.navy} />
          <Text style={styles.backBtnHeaderText} numberOfLines={1}>
            Back
          </Text>
        </TouchableOpacity>
      )}
      {isOnScanner ? null : (
        <TouchableOpacity
          onPress={() => {
            haptics.light();
            stackNav.navigate('Settings');
          }}
          style={[styles.gearBtn, {top: insets.top + 36}]}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Icon name="settings-outline" size={22} color={COLORS.navy} />
        </TouchableOpacity>
      )}
      <Tab.Navigator
        initialRouteName="Dashboard"
        screenOptions={{
          headerShown: false,
          tabBarStyle: isTablet
            ? [
                styles.tabBar,
                {
                  height: 80 + insets.bottom,
                  paddingTop: 8,
                  paddingBottom: insets.bottom + 8,
                },
              ]
            : styles.tabBar,
          tabBarActiveTintColor: COLORS.crimson,
          tabBarInactiveTintColor: COLORS.textDim,
          tabBarLabelStyle: isTablet ? styles.tabBarLabelTablet : styles.tabBarLabel,
          tabBarIconStyle: isTablet ? styles.tabBarIconTablet : undefined,
          tabBarBadgeStyle: styles.tabBarBadge,
          tabBarButton: (props) => <TabButton {...props} />,
        }}>
        <Tab.Screen
          name="Dashboard"
          component={DashboardScreen}
          options={{
            tabBarIcon: ({color, size}) => (
              <Icon name="stats-chart" size={size} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="QuickSale"
          component={QuickSaleStack}
          listeners={popToRootOnReTap}
          options={{
            tabBarLabel: 'Sale',
            tabBarIcon: ({color, size}) => (
              <Icon name="cart" size={size} color={color} />
            ),
            tabBarBadge:
              cartCount === 0
                ? undefined
                : cartCount > 99
                  ? '99+'
                  : String(cartCount),
            tabBarAccessibilityLabel:
              cartCount > 0
                ? `Sale tab, ${cartCount} ${cartCount === 1 ? 'item' : 'items'} in cart`
                : undefined,
          }}
        />
        <Tab.Screen
          name="Items"
          component={ItemsStack}
          listeners={popToRootOnReTap}
          options={{
            tabBarIcon: ({color, size}) => (
              <Icon name="cube" size={size} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="Customers"
          component={CustomersStack}
          listeners={popToRootOnReTap}
          options={{
            tabBarIcon: ({color, size}) => (
              <Icon name="people" size={size} color={color} />
            ),
          }}
        />
        {/* Repairs Tab.Screen is ALWAYS registered so aeris://repairs/:id
            deep-links resolve and cross-tab getParent()?.navigate('Repairs')
            works even when the flag is off. Visibility is gated via
            tabBarButton returning null, which removes it from the visible tab
            bar without deregistering the route — a deep-link hitting a
            hidden tab bounces at the screen mount-guard rather than 404ing
            through the linking layer. */}
        <Tab.Screen
          name="Repairs"
          component={RepairsStack}
          listeners={popToRootOnReTap}
          options={{
            tabBarLabel: 'Repairs',
            tabBarIcon: ({color, size}) => (
              <Icon name="construct-outline" size={size} color={color} />
            ),
            tabBarButton: showRepairsTab ? undefined : () => null,
            tabBarItemStyle: showRepairsTab ? undefined : {display: 'none'},
          }}
        />
        <Tab.Screen
          name="Transactions"
          component={TransactionsStack}
          listeners={popToRootOnReTap}
          options={{
            tabBarIcon: ({color, size}) => (
              <Icon name="receipt" size={size} color={color} />
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
                <Icon name="globe" size={size} color={color} />
              ),
            }}
          />
        )}
      </Tab.Navigator>
    </View>
  );
};

// AppStack — native-stack wrapper around the tab navigator. Hosts the
// Settings page as a sibling route so the gear icon pushes a real
// screen (slide-in on iOS, fade on Android) rather than opening a
// bottom-sheet modal. RootNavigator continues to import this file's
// default export, so this wrapper is transparent to upstream code.
const Stack = createNativeStackNavigator<AppStackParamList>();

const AppTabs: React.FC = () => (
  <Stack.Navigator
    initialRouteName="Tabs"
    screenOptions={{
      headerShown: false,
      // SettingsScreen owns its own header (back chevron + title +
      // save). Default native-stack animations: slide-from-right on
      // iOS, fade on Android — matches platform expectations and the
      // brief's "page-style transition" requirement.
    }}>
    <Stack.Screen name="Tabs" component={AppTabsInner} />
    <Stack.Screen name="Settings" component={SettingsScreen} />
  </Stack.Navigator>
);

const styles = StyleSheet.create({
  // Root bg is cream — the chrome (navy + cream cutouts + tongue) is
  // painted entirely inside BrandHeaderChrome's SVG, so the root only
  // needs to seed the cream that surrounds it.
  root: {flex: 1, backgroundColor: COLORS.background},
  gearBtn: {
    position: 'absolute',
    right: 12,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  // Mirror of gearBtn on the left. A row (chevron + "Back") rather than a
  // 44-square so the label reads clearly; left-anchored and absolutely
  // positioned so it never disturbs the centred wordmark.
  backBtnHeader: {
    position: 'absolute',
    left: 8,
    height: 44,
    maxWidth: 96, // cap so a large Dynamic-Type label can't reach the wordmark
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    zIndex: 3,
  },
  backBtnHeaderText: {
    color: COLORS.navy,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    marginLeft: 2,
    flexShrink: 1,
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
    fontFamily: FONT_FAMILY.medium,
  },
  tabBarLabelTablet: {
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    marginTop: 2,
  },
  tabBarIconTablet: {
    marginBottom: 2,
  },
  tabBarBadge: {
    backgroundColor: COLORS.cream,
    color: COLORS.crimson,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.bold,
    minWidth: 18,
    height: 18,
    lineHeight: 18,
    paddingHorizontal: 4,
  },
});

export default AppTabs;
