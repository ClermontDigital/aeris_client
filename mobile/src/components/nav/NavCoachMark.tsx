import React, {useEffect} from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import {COLORS, FONT_FAMILY, FONT_SIZE, SPACING, BORDER_RADIUS} from '../../constants/theme';
import {BTN} from './navGeometry';

const A_LOGO = require('../../../assets/images/aeris-a.png');

// First-run coach mark: dims the screen, spotlights the Aeris "A", and explains
// that it's how you get around. Presentational only — the parent owns the
// "seen once" persistence and passes visible/onDismiss.
interface Props {
  visible: boolean;
  onDismiss: () => void;
  // Screen-space centre of the A button.
  cx: number;
  cy: number;
}

const RING = BTN + 26; // halo diameter around the A

const NavCoachMark: React.FC<Props> = ({visible, onDismiss, cx, cy}) => {
  const {height} = useWindowDimensions();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      pulse.value = 0;
      pulse.value = withRepeat(
        withTiming(1, {duration: 1300, easing: Easing.inOut(Easing.quad)}),
        -1,
        true,
      );
    }
  }, [visible, pulse]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.25 + pulse.value * 0.4,
    transform: [{scale: 0.9 + pulse.value * 0.25}],
  }));

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent>
      {/* Tap anywhere to dismiss. */}
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss tip">
        {/* Pulsing halo + the spotlit A (a bright copy over the dim). */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            haloStyle,
            {left: cx - RING / 2, top: cy - RING / 2},
          ]}
        />
        <View
          pointerEvents="none"
          style={[styles.aBadge, {left: cx - BTN / 2, top: cy - BTN / 2}]}>
          <Image source={A_LOGO} style={styles.aLogo} resizeMode="contain" />
        </View>

        {/* Caption card sitting above the A, with a caret pointing down at it. */}
        <View
          style={[
            styles.card,
            {bottom: height - cy + BTN / 2 + 22},
          ]}>
          <Text style={styles.title}>This is how you get around</Text>
          <Text style={styles.body}>
            Tap the Aeris button any time to jump to Sale, Items, Customers,
            Repairs and more.
          </Text>
          <Pressable
            style={styles.gotIt}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Got it">
            <Text style={styles.gotItText}>Got it</Text>
          </Pressable>
        </View>
        <View style={[styles.caret, {left: cx - 9, bottom: height - cy + BTN / 2 + 10}]} />
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 22, 38, 0.82)',
  },
  halo: {
    position: 'absolute',
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    backgroundColor: COLORS.cream,
  },
  aBadge: {
    position: 'absolute',
    width: BTN,
    height: BTN,
    borderRadius: BTN / 2,
    backgroundColor: COLORS.navy,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.cream,
  },
  aLogo: {width: BTN * 0.62, height: BTN * 0.62},
  card: {
    position: 'absolute',
    left: SPACING.lg,
    right: SPACING.lg,
    backgroundColor: COLORS.cream,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    alignItems: 'center',
    // A little lift.
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 10,
  },
  title: {
    color: COLORS.navy,
    fontSize: FONT_SIZE.lg,
    fontFamily: FONT_FAMILY.bold,
    textAlign: 'center',
  },
  body: {
    marginTop: SPACING.xs,
    color: COLORS.navy,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.regular,
    textAlign: 'center',
    lineHeight: FONT_SIZE.sm * 1.4,
  },
  gotIt: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.crimson,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.xl,
    borderRadius: BORDER_RADIUS.full,
  },
  gotItText: {
    color: COLORS.cream,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.semibold,
  },
  // Downward caret bridging the card to the A.
  caret: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: COLORS.cream,
  },
});

export default NavCoachMark;
