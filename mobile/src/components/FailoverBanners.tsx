import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {COLORS, FONT_FAMILY, FONT_SIZE, SPACING} from '../constants/theme';
import {useCloudReachabilityStore} from '../stores/cloudReachabilityStore';
import {useFailoverAbortStore} from '../stores/failoverAbortStore';
import {useSettingsStore} from '../stores/settingsStore';

// FailoverBanners — the two thin, non-blocking DR banners that pin under the
// chrome tongue. Source of truth: §14.7 Q9 (cloud-unreachable) + §17.4 (abort
// to manual). Rendered once near the app root so they appear on every screen.
//
// Precedence: the §17.4 "NAS unreachable — use manual/paper" banner is the
// more severe state (we're mid-outage with no working server) and wins over
// the advisory "Cloud unreachable" banner.

export function FailoverBanners(): React.ReactElement | null {
  const cloudReachable = useCloudReachabilityStore(s => s.cloudReachable);
  const connectionMode = useSettingsStore(s => s.settings.connectionMode);
  const nasUnavailable = useFailoverAbortStore(s => s.nasUnavailable);
  const manualMode = useFailoverAbortStore(s => s.manualMode);

  // §17.4 abort-to-manual banner — most severe; render alone.
  if (nasUnavailable || manualMode) {
    return (
      <View style={[styles.banner, styles.abortBanner]} accessibilityRole="alert">
        <Text style={styles.abortText} numberOfLines={2}>
          {manualMode
            ? 'Manual mode — recording sales is paused. Take payment and write the sale on paper.'
            : 'In-store server unreachable — use manual / paper until it returns.'}
        </Text>
      </View>
    );
  }

  // §14.7 Q9 cloud-unreachable advisory — only meaningful while we're still
  // pointed at the cloud (relay mode). In Direct mode the cloud being down is
  // expected and not actionable, so suppress it there.
  if (cloudReachable === false && connectionMode !== 'direct') {
    return (
      <CloudUnreachableBanner />
    );
  }

  return null;
}

// Pulled out so the "switch to in-store" CTA can hook the Settings flow later
// without bloating the parent. In M1 it's advisory copy only (cashier-as-
// detector); the actual switch stays in Settings → Connection (§14.7 copy).
function CloudUnreachableBanner(): React.ReactElement {
  return (
    <View style={[styles.banner, styles.cloudBanner]} accessibilityRole="alert">
      <Text style={styles.cloudText} numberOfLines={2}>
        Cloud unreachable. Check your connection — or switch to in-store mode in
        Settings to keep selling.
      </Text>
    </View>
  );
}

// Exported for tests / call sites that want only the abort CTA inline.
export function ReturnToManualButton(): React.ReactElement {
  const returnToManual = useFailoverAbortStore(s => s.returnToManual);
  return (
    <TouchableOpacity
      style={styles.cta}
      onPress={returnToManual}
      accessibilityRole="button"
      accessibilityLabel="Return to manual or paper">
      <Text style={styles.ctaText}>Return to manual</Text>
    </TouchableOpacity>
  );
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
  cta: {
    marginTop: SPACING.xs,
    minHeight: 36,
    paddingHorizontal: SPACING.md,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.cream,
  },
  ctaText: {
    color: COLORS.destructive,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.semibold,
  },
});
