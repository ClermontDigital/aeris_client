import React from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  View,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
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

// Mobile counterpart to the marketing website's nav CTA pattern
// (aeris_websitev3/app/components/Navigation.tsx, the "Try it free"
// button). Two variants:
//   - 'outline' (default): 1px crimson border, transparent background, crimson
//     text. On press the pill fills crimson and the label flips to cream —
//     mirrors the web's hover state, just bound to Pressable's pressed
//     callback instead.
//   - 'solid': pre-filled crimson with cream text, for primary CTAs
//     (LoginScreen submit, "Start a Sale" on the dashboard, etc).
// Padding/typography is tuned to match the web pill almost exactly:
// vertical padding sits between sm and md so the pill stays compact,
// horizontal padding is lg so labels breathe.

export type PillButtonVariant = 'outline' | 'solid';

export interface PillButtonProps {
  label: string;
  onPress: () => void;
  variant?: PillButtonVariant;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

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

  const handlePress = () => {
    if (disabled) return;
    haptics.light();
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{disabled}}
      // Pressable's children-as-function form lets us flip styles in the
      // pressed state without a state hook — matches the web's :hover.
      style={({pressed}) => [
        styles.base,
        variant === 'solid' ? styles.solid : styles.outline,
        variant === 'outline' && pressed && !disabled && styles.outlinePressed,
        variant === 'solid' && pressed && !disabled && styles.solidPressed,
        disabled && styles.disabled,
        style,
      ]}>
      {({pressed}) => {
        const isFilled =
          variant === 'solid' || (variant === 'outline' && pressed && !disabled);
        const fgColor = isFilled ? COLORS.textOnDark : COLORS.crimson;
        return (
          <View style={styles.inner}>
            {icon ? (
              <Ionicons
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
              ]}>
              {label}
            </Text>
          </View>
        );
      }}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: BORDER_RADIUS.full,
    paddingVertical: SPACING.sm + 4,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outline: {
    backgroundColor: COLORS.transparent,
    borderWidth: 1,
    borderColor: COLORS.crimson,
  },
  outlinePressed: {
    backgroundColor: COLORS.crimson,
  },
  solid: {
    backgroundColor: COLORS.crimson,
    borderWidth: 1,
    borderColor: COLORS.crimson,
  },
  solidPressed: {
    backgroundColor: COLORS.crimsonDark,
    borderColor: COLORS.crimsonDark,
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
    fontFamily: FONT_FAMILY.medium,
    fontSize: FONT_SIZE.md,
    letterSpacing: LETTER_SPACING.wideSm,
  },
});

export default PillButton;
