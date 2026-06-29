import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {COLORS, FONT_FAMILY, FONT_SIZE, SPACING} from '../constants/theme';
import {useCloudReachabilityStore} from '../stores/cloudReachabilityStore';
import {useFailoverAbortStore} from '../stores/failoverAbortStore';
import {useSettingsStore} from '../stores/settingsStore';
import {useDrStore} from '../stores/drStore';

// FailoverBanners — the thin, non-blocking DR banners that pin under the
// chrome tongue. Source of truth: §14.7 Q9 (cloud-unreachable) + §17.4.
//
// Gating: the on-prem-specific banner only fires when the device has a
// rails-delivered local_url cached (provisioned). Cloud-only shops never
// see the "On-prem server unreachable" banner — there is no NAS for it
// to refer to. The cloud-unreachable advisory still fires on cloud-only
// shops, but with shorter copy (no "switch to in-store" CTA — there's
// nowhere to switch to).
//
// Precedence: the on-prem-unreachable banner is the more severe state
// (provisioned shop mid-outage with no working server) and wins.

export function FailoverBanners(): React.ReactElement | null {
  const cloudReachable = useCloudReachabilityStore(s => s.cloudReachable);
  const connectionMode = useSettingsStore(s => s.settings.connectionMode);
  const nasUnavailable = useFailoverAbortStore(s => s.nasUnavailable);
  const cachedLocalUrl = useDrStore(s => s.cachedLocalUrl);
  const provisioned = cachedLocalUrl != null;

  // Most severe — only meaningful on a provisioned shop (cloud-only shops
  // have no NAS to be "unreachable").
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
            ? 'Cloud unreachable. Check your connection — or switch to on-prem mode in Settings.'
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
