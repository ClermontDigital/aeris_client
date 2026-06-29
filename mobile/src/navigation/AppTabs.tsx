import React, {useMemo} from 'react';
import {
  View,
  Text,
  Image,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  GestureResponderEvent,
  useWindowDimensions,
} from 'react-native';
import {SafeAreaView, useSafeAreaInsets} from 'react-native-safe-area-context';
import Svg, {Path} from 'react-native-svg';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {useNavigation, StackActions} from '@react-navigation/native';
import type {BottomTabBarButtonProps} from '@react-navigation/bottom-tabs';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import Icon from '../components/Icon';
import {ModeIndicator} from '../components/ModeIndicator';
import {FailoverBanners} from '../components/FailoverBanners';
import DashboardScreen from '../screens/DashboardScreen';
import QuickSaleStack from './QuickSaleStack';
import ItemsStack from './ItemsStack';
import CustomersStack from './CustomersStack';
import TransactionsStack from './TransactionsStack';
import ERPScreen from '../screens/ERPScreen';
import {SettingsScreen} from '../screens/SettingsModal';
import {useSettingsStore} from '../stores/settingsStore';
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
const BAND_TOP = 30;
// BAND_H is the vertical span of the Bezier shoulder — the curve from
// (ttiL, cutoutTopY) to (tbiL, bandY). Smaller = less navy sitting below
// the wordmark before the tongue starts. Tuned to 36 in v1.3.47 (was 48).
const BAND_H = 36;
const TONGUE_TOP_W = 200;
const TONGUE_BOTTOM_W = 140;
const TONGUE_PROTRUSION = 16;
const TONGUE_RADIUS = 14;

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
  const {width: screenWidth} = useWindowDimensions();
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

  // Chrome layout:
  //   y = 0          → screen top (behind status bar)
  //   y = cutoutTopY → top of the cream cutout. Above this the chrome
  //                    stays full-width (no taper into the safe area).
  //   y = bandY      → bottom of the Bezier shoulder = tongue starts
  //   y = tongueBottomY → bottom of the tongue
  const cutoutTopY = insets.top + BAND_TOP;
  const bandY = cutoutTopY + BAND_H;
  const tongueBottomY = bandY + TONGUE_PROTRUSION;
  const svgHeight = tongueBottomY;

  const paths = useMemo(() => {
    const cx = screenWidth / 2;
    const ttiL = cx - TONGUE_TOP_W / 2;
    const ttiR = cx + TONGUE_TOP_W / 2;
    const tbiL = cx - TONGUE_BOTTOM_W / 2;
    const tbiR = cx + TONGUE_BOTTOM_W / 2;
    return {
      // Cream cutout starts at cutoutTopY (NOT at SVG y=0) so the chrome
      // stays full-width from screen top down to cutoutTopY — wide navy
      // banner with sharp 90° outer corners. Bezier control at
      // (tbiL, cutoutTopY) / (tbiR, cutoutTopY) keeps horizontal tangent
      // at the chrome bottom edge and vertical tangent at the tongue side.
      creamLeft:
        `M 0 ${cutoutTopY} L ${ttiL} ${cutoutTopY} ` +
        `Q ${tbiL} ${cutoutTopY}, ${tbiL} ${bandY} ` +
        `L ${tbiL} ${tongueBottomY - TONGUE_RADIUS} ` +
        `A ${TONGUE_RADIUS} ${TONGUE_RADIUS} 0 0 0 ${tbiL + TONGUE_RADIUS} ${tongueBottomY} ` +
        `L 0 ${tongueBottomY} Z`,
      creamRight:
        `M ${screenWidth} ${cutoutTopY} L ${ttiR} ${cutoutTopY} ` +
        `Q ${tbiR} ${cutoutTopY}, ${tbiR} ${bandY} ` +
        `L ${tbiR} ${tongueBottomY - TONGUE_RADIUS} ` +
        `A ${TONGUE_RADIUS} ${TONGUE_RADIUS} 0 0 1 ${tbiR - TONGUE_RADIUS} ${tongueBottomY} ` +
        `L ${screenWidth} ${tongueBottomY} Z`,
      tongue:
        `M ${tbiL} ${bandY} L ${tbiR} ${bandY} ` +
        `L ${tbiR} ${tongueBottomY - TONGUE_RADIUS} ` +
        `A ${TONGUE_RADIUS} ${TONGUE_RADIUS} 0 0 1 ${tbiR - TONGUE_RADIUS} ${tongueBottomY} ` +
        `L ${tbiL + TONGUE_RADIUS} ${tongueBottomY} ` +
        `A ${TONGUE_RADIUS} ${TONGUE_RADIUS} 0 0 1 ${tbiL} ${tongueBottomY - TONGUE_RADIUS} Z`,
    };
  }, [screenWidth, cutoutTopY, bandY, tongueBottomY]);

  return (
    <View style={styles.root}>
      {isOnScanner ? null : (
        <SafeAreaView edges={['top']} style={styles.topBar}>
          {/* SVG sibling of topBarRow, absolute-positioned to cover from
              the SafeAreaView's outer top (behind the status bar) down
              past the tongue. Painting the chrome inside the SVG — rather
              than relying on SafeAreaView's bg — gives the chrome a
              continuous tapered silhouette with no 90° step at the safe
              area boundary. */}
          <View
            style={[styles.svgWrap, {height: svgHeight}]}
            pointerEvents="none">
            <Svg width={screenWidth} height={svgHeight}>
              <Path
                d={`M0 0 H${screenWidth} V${svgHeight} H0 Z`}
                fill={COLORS.background}
              />
              <Path
                d={`M0 0 H${screenWidth} V${bandY} H0 Z`}
                fill={COLORS.navy}
              />
              <Path d={paths.creamLeft} fill={COLORS.background} />
              <Path d={paths.creamRight} fill={COLORS.background} />
              <Path d={paths.tongue} fill={COLORS.navy} />
            </Svg>
          </View>
          <View style={styles.topBarRow}>
            <Image
              source={require('../../assets/images/aeris-wordmark.png')}
              style={styles.brandWordmark}
              accessibilityIgnoresInvertColors
              accessibilityLabel="Aeris"
              resizeMode="contain"
            />
          </View>
          {/* §19.3 mode indicator — right-anchored, just inboard of the gear,
              so it clusters with the gear instead of crowding the wordmark.
              Suppressed only while Scanner is focused, mirroring the gear. */}
          {isOnScanner ? null : (
            <ModeIndicator topOffset={insets.top + 36} />
          )}
          {/* §14.7 Q9 + §17.4 DR banners — thin, non-blocking, under the
              tongue so they sit on every screen without their own chrome. */}
          <FailoverBanners />
        </SafeAreaView>
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
  // Root bg flipped from navy to cream — the chrome is now painted
  // entirely inside the SVG, so the root no longer needs to seed navy.
  // Keeping it navy would leak through the cream cutouts at the screen
  // edges in any non-SVG-painted region (e.g. below the tongue).
  root: {flex: 1, backgroundColor: COLORS.background},
  // SafeAreaView bg flipped to transparent for the same reason — the
  // SVG paints the navy chrome rect itself, including the safe-area
  // zone. zIndex:2 keeps the SafeAreaView (and its overflowing SVG —
  // the tongue protrudes TONGUE_PROTRUSION px past the SafeAreaView's
  // box) above the Tab.Navigator that renders later in the JSX flow.
  topBar: {backgroundColor: 'transparent', overflow: 'visible', zIndex: 2},
  topBarRow: {
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  // svgWrap covers the FULL chrome area, anchored at the SafeAreaView's
  // outer top (top:0 — position:absolute is relative to the padding
  // edge, which sits at the safe-area-view's outer top, not after its
  // paddingTop). The SVG inside is sized to bandY + TONGUE_PROTRUSION,
  // so it paints the chrome from behind the status bar down through
  // the tongue.
  svgWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  brandWordmark: {
    width: 130,
    height: 38,
    // Small upward nudge against the safe-area top — the wordmark was
    // sitting a touch low under the notch on iPhones with smaller bezels.
    marginTop: -6,
    marginBottom: -10,
    zIndex: 2,
  },
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
