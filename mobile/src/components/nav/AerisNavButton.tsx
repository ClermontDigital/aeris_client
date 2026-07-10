import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Svg, {Path} from 'react-native-svg';
import Animated, {
  cancelAnimation,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from '../Icon';
import NavCoachMark from './NavCoachMark';
import {useHaptics} from '../../hooks/useHaptics';
import {useAppLockStore} from '../../stores/appLockStore';
import {useCartStore} from '../../stores/cartStore';
import {useWorkspaceFeaturesStore} from '../../stores/workspaceFeaturesStore';
import {getItemCount} from '@aeris/shared';
import {COLORS, FONT_FAMILY, FONT_SIZE} from '../../constants/theme';
import {
  angleFor,
  buttonCenterFromBottom,
  BTN,
  BUBBLE,
  CIRCLE,
  domeCapPath,
  PROTRUSION,
  radiusFor,
} from './navGeometry';

const A_LOGO = require('../../../assets/images/aeris-a.png');
type IconName = React.ComponentProps<typeof Icon>['name'];

// First-run coach mark: shown once ever, then remembered.
const COACH_SEEN_KEY = '@aeris/nav-coach-seen-v1';
// Session guard so a remount (e.g. leaving the Scanner) doesn't re-fire it
// before the async write lands.
let coachShownThisSession = false;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Fan destinations, left→right along the arc (Sale lands near the top-centre).
// `route` is the target passed to onNavigate. `gate` names a conditional flag
// ('repairs' / 'erp') the caller controls; ungated entries always show.
const DESTS: {route: string; label: string; icon: IconName; gate?: 'repairs' | 'erp'}[] =
  [
    {route: 'Dashboard', label: 'Dashboard', icon: 'stats-chart'},
    {route: 'Items', label: 'Items', icon: 'cube'},
    {route: 'Customers', label: 'Customers', icon: 'people'},
    {route: 'QuickSale', label: 'Sale', icon: 'cart'},
    {route: 'Repairs', label: 'Repairs', icon: 'construct-outline', gate: 'repairs'},
    {route: 'Transactions', label: 'Sales', icon: 'receipt'},
    {route: 'ERP', label: 'Aeris', icon: 'globe', gate: 'erp'},
    // Settings is intentionally NOT here — it lives on the header gear, which is
    // enough for an infrequent destination (keeps the fan focused on POS flow).
  ];

interface Props {
  // The focused tab route name, for highlighting the active option.
  activeTab?: string;
  // Navigate to a destination route ('Settings' or a tab name).
  onNavigate: (route: string) => void;
  // Whether the ERP tab is currently surfaced (mirrors AppTabs' showErpTab).
  showErp?: boolean;
}

const AerisNavButton: React.FC<Props> = ({activeTab, onNavigate, showErp}) => {
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const haptics = useHaptics();
  const showRepairs = useWorkspaceFeaturesStore(s => s.repairs_enabled);
  const cartCount = useCartStore(s => getItemCount(s.items));
  // The tab shell stays mounted BEHIND the PIN/Face-ID lock overlay, so gate
  // the first-run coach mark on being unlocked — otherwise its timer fires and
  // the tip pops over the lock screen.
  const isLocked = useAppLockStore(s => s.isLocked);

  const progress = useSharedValue(0);
  const [mounted, setMounted] = useState(false);
  const openRef = useRef(false);

  const close = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    haptics.light();
    progress.value = withTiming(0, {duration: 190}, finished => {
      'worklet';
      if (finished) runOnJS(setMounted)(false);
    });
  }, [haptics, progress]);

  const openFan = useCallback(() => {
    openRef.current = true;
    haptics.medium();
    setMounted(true);
    progress.value = withSpring(1, {damping: 14, stiffness: 150, mass: 0.8});
  }, [haptics, progress]);

  const toggle = useCallback(
    () => (openRef.current ? close() : openFan()),
    [close, openFan],
  );

  // Stop any in-flight animation if we unmount mid-transition (e.g. the
  // Scanner surface takes over) so no callback fires after teardown.
  useEffect(() => () => cancelAnimation(progress), [progress]);

  // First-run coach mark — spotlight the A once so a new user learns it's the
  // way around. Shown after a short settle delay, then remembered forever.
  const [coachVisible, setCoachVisible] = useState(false);
  useEffect(() => {
    // Only ever once, and never while locked (re-runs when the lock lifts).
    if (isLocked || coachShownThisSession) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    AsyncStorage.getItem(COACH_SEEN_KEY)
      .then(seen => {
        if (cancelled || seen) return;
        timer = setTimeout(() => {
          if (cancelled) return;
          coachShownThisSession = true;
          setCoachVisible(true);
        }, 900);
      })
      .catch(() => {
        // Storage unavailable — skip the coach rather than block nav.
      });
    // Cleanup also fires if the app re-locks within the settle delay, cancelling
    // the pending timer so the tip can't surface over the lock screen.
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isLocked]);
  const dismissCoach = useCallback(() => {
    setCoachVisible(false);
    AsyncStorage.setItem(COACH_SEEN_KEY, '1').catch(() => undefined);
  }, []);

  const dests = useMemo(() => {
    const visible = DESTS.filter(d => {
      if (d.gate === 'repairs') return showRepairs;
      if (d.gate === 'erp') return !!showErp;
      return true;
    });
    return visible.map(d => ({
      ...d,
      active: d.route === activeTab,
      badge:
        d.route === 'QuickSale' && cartCount > 0 ? cartCount : (undefined as
          | number
          | undefined),
      onPress: () => {
        haptics.selection();
        close();
        onNavigate(d.route);
      },
    }));
  }, [showRepairs, showErp, activeTab, cartCount, haptics, close, onNavigate]);

  // Button centre in screen coords — the flat-bar-top line (floored so the A
  // isn't clipped on a thin bar with no safe-area inset).
  const cx = width / 2;
  const cy = height - buttonCenterFromBottom(insets.bottom);
  const cap = useMemo(() => domeCapPath(width), [width]);

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1], Extrapolation.CLAMP),
  }));
  const bloomStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.6, 1], [0, 0.3, 0]),
    transform: [
      {scale: interpolate(progress.value, [0, 1], [0.6, 2.4], Extrapolation.CLAMP)},
    ],
  }));
  const aStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.45], [1, 0], Extrapolation.CLAMP),
  }));
  const xStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.4, 1], [0, 1], Extrapolation.CLAMP),
  }));
  const spinStyle = useAnimatedStyle(() => ({
    transform: [
      {
        rotate: `${interpolate(
          progress.value,
          [0, 1],
          [0, 135],
          Extrapolation.CLAMP,
        )}deg`,
      },
      {scale: interpolate(progress.value, [0, 0.5, 1], [1, 0.9, 1])},
    ],
  }));

  return (
    <>
      {/* Full-screen overlay so the protruding button never gets touch-clipped
          by the (shorter) notch bar. box-none lets taps through everywhere
          except the button itself. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {/* Navy dome cap behind the A — floats over scrolling content and
            blends into the flat navy bar below it (same navy). */}
        <View
          style={[
            styles.cap,
            {left: 0, width, height: cap.svgH, top: cy - PROTRUSION},
          ]}
          pointerEvents="none">
          <Svg width={width} height={cap.svgH}>
            <Path d={cap.d} fill={COLORS.navy} />
          </Svg>
        </View>
        {!mounted && (
          <Pressable
            onPress={toggle}
            style={[styles.button, {left: cx - BTN / 2, top: cy - BTN / 2}]}
            accessibilityRole="button"
            accessibilityLabel={
              cartCount > 0
                ? `Open navigation menu, ${cartCount} in cart`
                : 'Open navigation menu'
            }
            hitSlop={12}>
            <Image source={A_LOGO} style={styles.aLogo} resizeMode="contain" />
            {/* At-a-glance cart count on the docked A (the old Sale-tab badge
                only lived on the tab bar). */}
            {cartCount > 0 && (
              <View style={styles.dockBadge}>
                <Text style={styles.badgeText}>
                  {cartCount > 99 ? '99+' : String(cartCount)}
                </Text>
              </View>
            )}
          </Pressable>
        )}
      </View>

      <Modal
        transparent
        visible={mounted}
        animationType="none"
        onRequestClose={close}
        statusBarTranslucent>
        <AnimatedPressable
          style={[styles.scrim, scrimStyle]}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close navigation menu"
        />
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {mounted &&
            dests.map((d, i) => (
            <FanBubble
              key={d.route}
              label={d.label}
              icon={d.icon}
              active={d.active}
              badge={d.badge}
              onPress={d.onPress}
              angle={angleFor(i, dests.length)}
              index={i}
              radius={radiusFor(dests.length)}
              progress={progress}
              cx={cx}
              cy={cy}
            />
          ))}

          <Animated.View
            style={[styles.bloom, bloomStyle, {left: cx - BTN / 2, top: cy - BTN / 2}]}
            pointerEvents="none"
          />
          <Animated.View
            style={[styles.button, spinStyle, {left: cx - BTN / 2, top: cy - BTN / 2}]}>
            <Pressable
              onPress={toggle}
              style={styles.buttonHit}
              accessibilityRole="button"
              accessibilityLabel="Close navigation menu"
              hitSlop={12}>
              <Animated.Image
                source={A_LOGO}
                style={[styles.aLogo, aStyle]}
                resizeMode="contain"
              />
              <Animated.View style={[styles.xWrap, xStyle]}>
                <Icon name="close" size={30} color={COLORS.cream} />
              </Animated.View>
            </Pressable>
          </Animated.View>
        </View>
      </Modal>

      <NavCoachMark
        visible={coachVisible && !isLocked}
        onDismiss={dismissCoach}
        cx={cx}
        cy={cy}
      />
    </>
  );
};

const FanBubble: React.FC<{
  label: string;
  icon: IconName;
  active: boolean;
  badge?: number;
  onPress: () => void;
  angle: number;
  index: number;
  radius: number;
  progress: SharedValue<number>;
  cx: number;
  cy: number;
}> = ({label, icon, active, badge, onPress, angle, index, radius, progress, cx, cy}) => {
  const dx = Math.sin(angle) * radius;
  const dy = -Math.cos(angle) * radius; // up = negative y
  const stagger = index * 0.05; // cascade in

  const style = useAnimatedStyle(() => {
    const local = interpolate(
      progress.value,
      [stagger, 1],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      opacity: interpolate(local, [0, 0.35, 1], [0, 0.9, 1]),
      transform: [
        {translateX: dx * local},
        {translateY: dy * local},
        {scale: interpolate(local, [0, 1], [0.35, 1])},
      ],
    };
  });

  return (
    <Animated.View
      style={[styles.bubble, style, {left: cx - BUBBLE / 2, top: cy - CIRCLE / 2}]}>
      <Pressable
        onPress={onPress}
        style={styles.bubbleHit}
        accessibilityRole="button"
        accessibilityLabel={label}>
        <View style={[styles.bubbleCircle, active && styles.bubbleActive]}>
          <Icon name={icon} size={24} color={active ? COLORS.cream : COLORS.navy} />
          {badge != null && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {badge > 99 ? '99+' : String(badge)}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.bubbleLabel} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  cap: {position: 'absolute'},
  button: {
    position: 'absolute',
    width: BTN,
    height: BTN,
    borderRadius: BTN / 2,
    backgroundColor: COLORS.navy,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 4},
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 8,
  },
  buttonHit: {
    width: BTN,
    height: BTN,
    borderRadius: BTN / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aLogo: {width: BTN * 0.62, height: BTN * 0.62},
  xWrap: {position: 'absolute', alignItems: 'center', justifyContent: 'center'},
  bloom: {
    position: 'absolute',
    width: BTN,
    height: BTN,
    borderRadius: BTN / 2,
    backgroundColor: COLORS.cream,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 34, 57, 0.55)',
  },
  bubble: {position: 'absolute', width: BUBBLE, alignItems: 'center'},
  bubbleHit: {alignItems: 'center', width: BUBBLE},
  bubbleCircle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    backgroundColor: COLORS.cream,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.24,
    shadowRadius: 5,
    elevation: 6,
  },
  bubbleActive: {backgroundColor: COLORS.crimson},
  bubbleLabel: {
    marginTop: 6,
    color: COLORS.cream,
    fontSize: FONT_SIZE.xs,
    fontFamily: FONT_FAMILY.semibold,
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: COLORS.crimson,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Cart badge on the docked A — top-right, ringed in navy so it reads as a
  // pip on the button rather than blending into the crimson-on-navy chrome.
  dockBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: COLORS.crimson,
    borderWidth: 2,
    borderColor: COLORS.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {color: COLORS.cream, fontSize: 10, fontFamily: FONT_FAMILY.bold},
});

export default AerisNavButton;
