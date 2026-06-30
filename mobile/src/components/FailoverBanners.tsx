import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {COLORS, FONT_FAMILY, FONT_SIZE, SPACING} from '../constants/theme';
import {useCloudReachabilityStore} from '../stores/cloudReachabilityStore';
import {useFailoverAbortStore} from '../stores/failoverAbortStore';
import {useSettingsStore} from '../stores/settingsStore';
import {useDrStore} from '../stores/drStore';
import {useRoutingDecision} from '../hooks/useRoutingDecision';

// FailoverBanners — the thin, non-blocking DR banners that pin under the
// chrome tongue. Source of truth: §14.7 Q9 (cloud-unreachable) + §17.4.
//
// Gating: the on-prem-specific banner only fires when the device has a
// rails-delivered local_url cached (provisioned). Cloud-only deployments
// never see the "On-prem server unreachable" banner — there is no NAS
// for it to refer to. The cloud-unreachable advisory still fires on
// cloud-only deployments, but with shorter copy (no "switch to on-prem"
// CTA — there's nowhere to switch to).
//
// Precedence: the on-prem-unreachable banner is the more severe state
// (provisioned deployment mid-outage with no working server) and wins.

export function FailoverBanners(): React.ReactElement | null {
  const cloudReachable = useCloudReachabilityStore(s => s.cloudReachable);
  const connectionMode = useSettingsStore(s => s.settings.connectionMode);
  // M3-D — when the auto-failover flag is ON the copy changes from the manual
  // "switch in Settings" CTA to the informational "switched automatically".
  // Flag OFF keeps the exact M2 manual copy.
  const autoFailoverEnabled = useSettingsStore(
    s => s.settings.autoFailoverEnabled ?? false,
  );
  const nasUnavailable = useFailoverAbortStore(s => s.nasUnavailable);
  const cachedLocalUrl = useDrStore(s => s.cachedLocalUrl);
  const provisioned = cachedLocalUrl != null;
  // M3 polish — when an auto-swap is being held back by Rule 1 (a write is in
  // flight), surface that the switch is pending so a mid-tx defer doesn't read
  // as a hang. `deferred && reason==='outage-auto'` is exactly that state.
  const {deferred, reason} = useRoutingDecision();

  // Most severe — only meaningful on a provisioned deployment (cloud-only
  // deployments have no NAS to be "unreachable").
  if (provisioned && nasUnavailable) {
    return (
      <View
        style={[styles.banner, styles.abortBanner]}
        accessibilityRole="alert">
        <Text style={styles.abortText} numberOfLines={2}>
          On-prem server unreachable. Check the server and try again.
        </Text>
      </View>
    );
  }

  // M3 polish — an auto-failover is QUEUED but Rule 1 is deferring it because a
  // sale/settlement/write is still in flight. Reassure the cashier the switch
  // will happen the moment the transaction completes (so it doesn't read as a
  // hang). Sits above the steady cloud-unreachable advisory.
  if (deferred && reason === 'outage-auto') {
    return (
      <View
        style={[styles.banner, styles.cloudBanner]}
        accessibilityRole="alert">
        <Text style={styles.cloudText} numberOfLines={2}>
          Cloud unreachable. Will switch to on-prem mode after this sale.
        </Text>
      </View>
    );
  }

  // M3-A auto-mode confirmation: the flag is ON, we've auto-switched to the
  // on-prem (Direct) server, and the cloud is still down. Inform the cashier
  // the switch happened automatically (vs the manual "switch in Settings"
  // prompt below). Only while the cloud is actually unreachable — once it's
  // back, this clears (failback is M3-B).
  if (
    autoFailoverEnabled &&
    connectionMode === 'direct' &&
    provisioned &&
    cloudReachable === false
  ) {
    return (
      <View
        style={[styles.banner, styles.cloudBanner]}
        accessibilityRole="alert">
        <Text style={styles.cloudText} numberOfLines={2}>
          Switched to on-prem server automatically. Cloud is unreachable.
        </Text>
      </View>
    );
  }

  // §14.7 Q9 cloud-unreachable advisory — only meaningful while we're still
  // pointed at the cloud (relay mode). In Direct mode the cloud being down
  // is expected and not actionable.
  if (cloudReachable === false && connectionMode !== 'direct') {
    return (
      <View
        style={[styles.banner, styles.cloudBanner]}
        accessibilityRole="alert">
        <Text style={styles.cloudText} numberOfLines={2}>
          {provisioned
            ? autoFailoverEnabled
              ? 'Cloud unreachable. Switching to on-prem mode…'
              : 'Cloud unreachable. Check your connection — or switch to on-prem mode in Settings.'
            : 'Cloud unreachable. Check your connection.'}
        </Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  banner: {
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  abortBanner: {
    // Navy-on-crimson per §21 — the most severe DR state.
    backgroundColor: COLORS.destructive,
  },
  abortText: {
    color: COLORS.cream,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.semibold,
    textAlign: 'center',
    lineHeight: 16,
  },
  cloudBanner: {
    backgroundColor: COLORS.warningBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.warningBorder,
  },
  cloudText: {
    color: COLORS.warningText,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    textAlign: 'center',
    lineHeight: 16,
  },
});
