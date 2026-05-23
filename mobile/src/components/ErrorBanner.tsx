import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import Icon from './Icon';
import {useAuthStore} from '../stores/authStore';
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
  // Suppress the banner the instant the auth store wipes the session — a 401
  // routes through clearLocalSession which flips isAuthenticated to false and
  // the RootNavigator transitions to the Auth stack with a fade animation.
  // During that fade the originating screen (Dashboard, Items, etc.) stays
  // mounted for ~250ms and its catch block has already called setError, so
  // without this guard the user briefly sees "Authentication expired. Retry"
  // before landing on LoginScreen — confusing UX. The LoginScreen has its own
  // "Your session expired" affordance keyed on errorKind === 'expired'.
  //
  // We subscribe to the auth store via zustand's non-hook `subscribe()` API
  // and force a local re-render when the relevant slice changes, instead of
  // using `useAuthStore(selector)`. The selector path goes through
  // `useSyncExternalStoreWithSelector` which calls React hooks — and the
  // monorepo has a dual-React situation (root pulls react 18.3.1 for the
  // desktop client; this workspace ships 19.2.0). The store's React copy
  // and the renderer's can disagree, which under Jest in particular crashes
  // the hook call. `subscribe()` is just an event emitter and never touches
  // React, so it works regardless of which React zustand resolved against;
  // we then read state with `getState()` at render time and the forceTick
  // state below guarantees we re-render when auth flips.
  const [, forceTick] = React.useState(0);
  React.useEffect(
    () => useAuthStore.subscribe(() => forceTick(t => t + 1)),
    [],
  );
  const auth = useAuthStore.getState();
  if (!auth.isAuthenticated && auth.errorKind === 'expired') return null;

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
      <Icon
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
          <Icon name="close" size={ICON_SIZE.hero - 4} color={palette.fg} />
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
