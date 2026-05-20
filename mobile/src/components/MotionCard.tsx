import React, {useEffect} from 'react';
import type {ViewStyle, StyleProp} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

/**
 * Mobile counterpart to aeris_websitev3/app/components/AnimatedCard.tsx.
 *
 * Plays a one-shot mount animation: opacity 0 → 1 and translateY 20 → 0
 * over 350ms with an out-cubic easing. The web version also has a
 * `whileHover` press-lift; that pattern doesn't translate to a native
 * tap UX (no hover state on touch devices, and a transient lift on
 * press would just feel like jitter), so we deliberately omit it here.
 *
 * Use `delay` (ms) to stagger a row of cards — e.g. 0/60/120 across
 * three cards reads as a single coordinated entrance rather than
 * three independent fades.
 */
export interface MotionCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  delay?: number;
}

const DURATION_MS = 350;
const TRANSLATE_START = 20;

const MotionCard: React.FC<MotionCardProps> = ({children, style, delay = 0}) => {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(TRANSLATE_START);

  useEffect(() => {
    const easing = Easing.out(Easing.cubic);
    opacity.value = withDelay(
      delay,
      withTiming(1, {duration: DURATION_MS, easing}),
    );
    translateY.value = withDelay(
      delay,
      withTiming(0, {duration: DURATION_MS, easing}),
    );
  }, [delay, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{translateY: translateY.value}],
  }));

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
};

export default MotionCard;
