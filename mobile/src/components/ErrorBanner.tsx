import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {
  COLORS,
  SPACING,
  FONT_SIZE,
  FONT_FAMILY,
  BORDER_RADIUS,
  ICON_SIZE,
} from '../constants/theme';

export type ErrorBannerTone = 'error' | 'warning';

export interface ErrorBannerProps {
  message: string;
  tone?: ErrorBannerTone;
  onRetry?: () => void;
  onDismiss?: () => void;
}

// Mirrors client/src/renderer/components/ErrorBanner.tsx so the
// inline errorBanner pattern across Items/Transactions/etc. has one
// home with consistent retry/dismiss affordances.
const ErrorBanner: React.FC<ErrorBannerProps> = ({
  message,
  tone = 'error',
  onRetry,
  onDismiss,
}) => {
  const palette =
    tone === 'warning'
      ? {
          // 10% opacity warning bg with full-strength fg/icon
          bg: 'rgba(245, 158, 11, 0.1)',
          fg: COLORS.warning,
          icon: 'warning-outline' as const,
        }
      : {
          // 10% opacity crimson bg with full-strength fg/icon
          bg: 'rgba(193, 18, 31, 0.1)',
          fg: COLORS.danger,
          icon: 'alert-circle' as const,
        };

  return (
    <View
      style={[styles.container, {backgroundColor: palette.bg}]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite">
      <Ionicons
        name={palette.icon}
        size={ICON_SIZE.hero}
        color={palette.fg}
        style={styles.icon}
      />
      <Text style={[styles.message, {color: palette.fg}]} numberOfLines={3}>
        {message}
      </Text>
      {onRetry ? (
        <TouchableOpacity
          onPress={onRetry}
          style={styles.retryBtn}
          accessibilityRole="button"
          accessibilityLabel="Retry"
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Text style={[styles.retryText, {color: palette.fg}]}>Retry</Text>
        </TouchableOpacity>
      ) : null}
      {onDismiss ? (
        <TouchableOpacity
          onPress={onDismiss}
          style={styles.dismissBtn}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <Ionicons name="close" size={ICON_SIZE.hero - 4} color={palette.fg} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  icon: {marginRight: SPACING.sm},
  message: {
    flex: 1,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
  },
  retryBtn: {
    marginLeft: SPACING.sm,
    paddingHorizontal: SPACING.sm,
  },
  retryText: {
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.bold,
    textDecorationLine: 'underline',
  },
  dismissBtn: {
    marginLeft: SPACING.xs,
    padding: SPACING.xs,
  },
});

export default ErrorBanner;
