import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  View,
  Platform,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Icon from './Icon';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  FONT_FAMILY,
  BORDER_RADIUS,
  ICON_SIZE,
  LETTER_SPACING,
} from '../constants/theme';
import {useHaptics} from '../hooks/useHaptics';

// Button per AERIS Visual Brand Guidelines v0.3 §10.
// Variants mirror the spec's hierarchy:
//   - 'solid'       PRIMARY     — filled Red Dirt Red, white text, SemiBold.
//                                 Pill radius. One per view.
//   - 'secondary'   SECONDARY   — outlined Loyal Navy, navy text, no fill.
//                                 Same dimensions as primary.
//   - 'tertiary'    TERTIARY    — Loyal Navy text only, no fill, no border.
//   - 'destructive' DESTRUCTIVE — filled Royal Red. Irreversible actions only
//                                 (e.g. delete account).
//   - 'outline'     LEGACY      — crimson border that fills on press. Kept for
//                                 the marketing-site "Try it free" CTA echo on
//                                 LoginScreen / dashboard; avoid in new code,
//                                 prefer 'secondary'.
// Padding/typography is tuned to match the web pill: vertical padding sits
// between sm and md so the pill stays compact, horizontal padding is lg so
// labels breathe (1.5-2x the vertical, per §10).

export type PillButtonVariant =
  | 'solid'
  | 'secondary'
  | 'tertiary'
  | 'destructive'
  | 'outline';

export interface PillButtonProps {
  label: string;
  onPress: () => void;
  variant?: PillButtonVariant;
  disabled?: boolean;
  icon?: React.ComponentProps<typeof Icon>['name'];
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const PillButton: React.FC<PillButtonProps> = ({
  label,
  onPress,
  variant = 'outline',
  disabled = false,
  icon,
  accessibilityLabel,
  style,
}) => {
  const haptics = useHaptics();
  // Press-scale via Reanimated — runs on the UI thread, so the dip lands
  // even when JS is busy (catalog filter, store mutation, etc.). Tertiary
  // is "text-only" by spec, so we skip the scale there to keep that variant
  // calm. Tap haptic still fires.
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{scale: scale.value}],
  }));

  const handlePress = () => {
    if (disabled) return;
    haptics.light();
    onPress();
  };
  const handlePressIn = () => {
    if (disabled || variant === 'tertiary') return;
    scale.value = withTiming(0.97, {duration: 80});
  };
  const handlePressOut = () => {
    if (disabled || variant === 'tertiary') return;
    scale.value = withSpring(1, {damping: 14, stiffness: 220});
  };

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{disabled}}
      // Android-native ripple on top of the iOS-style scale — both platforms
      // get tactile feedback that matches the platform's idiom. Borderless
      // false so the ripple respects the pill shape.
      android_ripple={
        disabled || Platform.OS !== 'android'
          ? undefined
          : {
              color:
                variant === 'solid' || variant === 'destructive'
                  ? 'rgba(255,255,255,0.18)'
                  : 'rgba(193, 18, 31, 0.12)',
              borderless: false,
              foreground: true,
            }
      }
      // Pressable's children-as-function form lets us flip styles in the
      // pressed state without a state hook — matches the web's :hover.
      style={({pressed}) => [
        styles.base,
        variant === 'solid' && styles.solid,
        variant === 'secondary' && styles.secondary,
        variant === 'tertiary' && styles.tertiary,
        variant === 'destructive' && styles.destructive,
        variant === 'outline' && styles.outline,
        variant === 'outline' && pressed && !disabled && styles.outlinePressed,
        variant === 'solid' && pressed && !disabled && styles.solidPressed,
        variant === 'secondary' && pressed && !disabled && styles.secondaryPressed,
        variant === 'tertiary' && pressed && !disabled && styles.tertiaryPressed,
        variant === 'destructive' && pressed && !disabled && styles.destructivePressed,
        disabled && styles.disabled,
        animatedStyle,
        style,
      ]}>
      {({pressed}) => {
        const fgColor = resolveForeground(variant, pressed, disabled);
        return (
          <View style={styles.inner}>
            {icon ? (
              <Icon
                name={icon}
                size={ICON_SIZE.action - 2}
                color={fgColor}
                style={styles.icon}
              />
            ) : null}
            <Text
              style={[
                styles.label,
                {color: fgColor},
                variant === 'tertiary' && styles.tertiaryLabel,
              ]}>
              {label}
            </Text>
          </View>
        );
      }}
    </AnimatedPressable>
  );
};

function resolveForeground(
  variant: PillButtonVariant,
  pressed: boolean,
  disabled: boolean,
): string {
  if (variant === 'solid' || variant === 'destructive') return COLORS.white;
  if (variant === 'secondary' || variant === 'tertiary') return COLORS.navy;
  // 'outline' — crimson by default, cream when the pill fills on press.
  if (pressed && !disabled) return COLORS.textOnDark;
  return COLORS.crimson;
}

const styles = StyleSheet.create({
  base: {
    borderRadius: BORDER_RADIUS.full,
    paddingVertical: SPACING.sm + 4,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // PRIMARY — Red Dirt Red, white text (§10).
  solid: {
    backgroundColor: COLORS.crimson,
    borderWidth: 1,
    borderColor: COLORS.crimson,
  },
  solidPressed: {
    backgroundColor: COLORS.crimsonDark,
    borderColor: COLORS.crimsonDark,
  },
  // SECONDARY — outlined Loyal Navy, navy text, no fill (§10).
  secondary: {
    backgroundColor: COLORS.transparent,
    borderWidth: 1,
    borderColor: COLORS.navy,
  },
  secondaryPressed: {
    backgroundColor: 'rgba(0, 48, 73, 0.08)',
  },
  // TERTIARY — Loyal Navy text only, no border/fill (§10).
  tertiary: {
    backgroundColor: COLORS.transparent,
    borderWidth: 0,
    paddingHorizontal: SPACING.md,
  },
  tertiaryPressed: {
    backgroundColor: 'rgba(0, 48, 73, 0.06)',
  },
  // DESTRUCTIVE — Royal Red fill, white text. Irreversible actions only.
  destructive: {
    backgroundColor: COLORS.royal,
    borderWidth: 1,
    borderColor: COLORS.royal,
  },
  destructivePressed: {
    // Royal Red has no canonical darker shade in the palette; reuse Royal at
    // a slightly compressed value via crimsonInk (#6e0000) — the darker red
    // already used for pressed/active destructive states on the web.
    backgroundColor: COLORS.crimsonInk,
    borderColor: COLORS.crimsonInk,
  },
  // OUTLINE — legacy ghost-CTA (crimson border, crimson text, fills on press).
  outline: {
    backgroundColor: COLORS.transparent,
    borderWidth: 1,
    borderColor: COLORS.crimson,
  },
  outlinePressed: {
    backgroundColor: COLORS.crimson,
  },
  disabled: {
    opacity: 0.5,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    marginRight: SPACING.xs + 2,
  },
  label: {
    // SemiBold per §10 ("Poppins SemiBold") — was Medium previously.
    fontFamily: FONT_FAMILY.semibold,
    fontSize: FONT_SIZE.md,
    letterSpacing: LETTER_SPACING.wideSm,
  },
  tertiaryLabel: {
    textDecorationLine: 'underline',
  },
});

export default PillButton;
