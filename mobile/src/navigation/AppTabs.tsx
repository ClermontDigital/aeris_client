import React, {useMemo} from 'react';
import {
  View,
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
import {useCartStore} from '../stores/cartStore';
import {useNavHistoryStore} from '../stores/navHistoryStore';
import {useScannerVisibilityStore} from '../stores/scannerVisibilityStore';
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
const BAND_H = 48;
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
  const showErpTab = connectionMode !== 'relay' || isServerReachable;
  const haptics = useHaptics();
  const insets = useSafeAreaInsets();
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

  const paths = useMemo(() => {
    const cx = screenWidth / 2;
    // Top points: wide tongue shoulders. Bottom points: narrow tongue base.
    const ttiL = cx - TONGUE_TOP_W / 2;
    const ttiR = cx + TONGUE_TOP_W / 2;
    const tbiL = cx - TONGUE_BOTTOM_W / 2;
    const tbiR = cx + TONGUE_BOTTOM_W / 2;
    const tongueBottomY = BAND_H + TONGUE_PROTRUSION;
    return {
      // Cream cutouts extend the full SVG height (down to tongueBottomY)
      // and trace the tongue's bottom-corner arcs on their inner edge.
      // Stopping at BAND_H instead would leave the SVG below the chrome
      // transparent on the outer sides of the tongue, exposing the navy
      // SafeAreaView bg and showing two sharp 90° corners at the screen
      // edges. Quadratic control at (tbiL, 0) / (tbiR, 0) keeps a
      // horizontal tangent at the chrome top and vertical tangent at the
      // tongue side — smooth shoulder, no visible corner.
      creamLeft:
        `M 0 0 L ${ttiL} 0 ` +
        `Q ${tbiL} 0, ${tbiL} ${BAND_H} ` +
        `L ${tbiL} ${tongueBottomY - TONGUE_RADIUS} ` +
        `A ${TONGUE_RADIUS} ${TONGUE_RADIUS} 0 0 0 ${tbiL + TONGUE_RADIUS} ${tongueBottomY} ` +
        `L 0 ${tongueBottomY} Z`,
      creamRight:
        `M ${screenWidth} 0 L ${ttiR} 0 ` +
        `Q ${tbiR} 0, ${tbiR} ${BAND_H} ` +
        `L ${tbiR} ${tongueBottomY - TONGUE_RADIUS} ` +
        `A ${TONGUE_RADIUS} ${TONGUE_RADIUS} 0 0 1 ${tbiR - TONGUE_RADIUS} ${tongueBottomY} ` +
        `L ${screenWidth} ${tongueBottomY} Z`,
      tongue:
        `M ${tbiL} ${BAND_H} L ${tbiR} ${BAND_H} ` +
        `L ${tbiR} ${tongueBottomY - TONGUE_RADIUS} ` +
        `A ${TONGUE_RADIUS} ${TONGUE_RADIUS} 0 0 1 ${tbiR - TONGUE_RADIUS} ${tongueBottomY} ` +
        `L ${tbiL + TONGUE_RADIUS} ${tongueBottomY} ` +
        `A ${TONGUE_RADIUS} ${TONGUE_RADIUS} 0 0 1 ${tbiL} ${tongueBottomY - TONGUE_RADIUS} Z`,
    };
  }, [screenWidth]);

  const svgHeight = BAND_H + TONGUE_PROTRUSION;

  return (
    <View style={styles.root}>
      {isOnScanner ? null : (
        <SafeAreaView edges={['top']} style={styles.topBar}>
          <View style={styles.topBarRow}>
            <View
              style={[styles.svgWrap, {height: svgHeight}]}
              pointerEvents="none">
              <Svg width={screenWidth} height={svgHeight}>
                {/* Self-contained pendant: every pixel inside the SVG box
                    is painted by the SVG itself, not borrowed from a
                    parent layer. Order matters — base cream first, navy
                    chrome strip on top, cream cutouts eat into chrome on
                    the sides, tongue protrudes below. Without the explicit
                    base+chrome rects the cream cutouts depend on the
                    SafeAreaView bg above and the Tab.Navigator screen
                    below resolving to the right colors, which doesn't
                    hold in iOS's overflow:visible compositing path — the
                    transparent gap below topBar would expose navy and
                    paint two visible 90° corners at the screen edges. */}
                <Path
                  d={`M0 0 H${screenWidth} V${svgHeight} H0 Z`}
                  fill={COLORS.background}
                />
                <Path
                  d={`M0 0 H${screenWidth} V${BAND_H} H0 Z`}
                  fill={COLORS.navy}
                />
                <Path d={paths.creamLeft} fill={COLORS.background} />
                <Path d={paths.creamRight} fill={COLORS.background} />
                <Path d={paths.tongue} fill={COLORS.navy} />
              </Svg>
            </View>
            <Image
              source={require('../../assets/images/aeris-wordmark.png')}
              style={styles.brandWordmark}
              accessibilityIgnoresInvertColors
              accessibilityLabel="Aeris"
              resizeMode="contain"
            />
          </View>
        </SafeAreaView>
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
          tabBarStyle: styles.tabBar,
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
  root: {flex: 1, backgroundColor: COLORS.navy},
  topBar: {backgroundColor: COLORS.navy, overflow: 'visible'},
  topBarRow: {
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  // The Svg lives flush to the left edge and the cream/navy boundary
  // resolves itself within the path data — no flex/centre layout to
  // fight with. `top: BAND_TOP` puts the band below the navy chrome
  // strip so the wordmark, which is centred in topBarRow, straddles
  // the chrome and the tongue.
  svgWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: BAND_TOP,
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
