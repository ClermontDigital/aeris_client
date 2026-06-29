import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import Modal from 'react-native-modal';
import {COLORS, FONT_FAMILY, FONT_SIZE, SPACING} from '../constants/theme';
import {useRoutingDecision} from '../hooks/useRoutingDecision';
import {useDrStore} from '../stores/drStore';
import {useCloudReachabilityStore} from '../stores/cloudReachabilityStore';
import {useSettingsStore} from '../stores/settingsStore';
import EyebrowLabel from './EyebrowLabel';
import type {CertTrust} from '../types/dr.types';

// ModeDetailSheet — the tap-through detail for the ModeIndicator chip.
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §19.3, §18.
//
// Split into two honest sections:
//   • Cloud — always shown. Online / unreachable + workspace.
//   • On-prem server — always shown. When the device has no rails-delivered
//     local_url cached, the section reads "Not set up" with no NAS fields.
//     When provisioned, it shows the masked address + last-sync + identity.
//
// The §17.4 manual / paper toggle was removed: it froze writes globally with
// no clear path back, and on a cloud-only shop it surfaced controls that
// have no NAS to fall back to. The state engine still drives Checkout's
// write gate when the NAS is genuinely unreachable (§19.2 cascade).

// §18 cert-trust readout. Until SPKI-pinning lands (see drStore §22.5 Q7 TODO)
// the trust is 'unverified' — we say so plainly so a redirect to an unpinned
// host is visible, not silent (§15-2(c)).
const CERT_COPY: Record<CertTrust, {label: string; color: string}> = {
  trusted: {label: 'Verified (pinned)', color: COLORS.success},
  unverified: {label: 'Not yet verified', color: COLORS.warning},
  mismatch: {label: 'Mismatch — connection refused', color: COLORS.danger},
  unknown: {label: 'Unknown', color: COLORS.textMuted},
};

function formatLastSync(iso: string | null): string {
  if (!iso) return 'Never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Unknown';
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins <= 0) return 'Just now';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function ModeDetailSheet({visible, onClose}: Props): React.ReactElement {
  const {currentMode} = useRoutingDecision();
  const certTrust = useDrStore(s => s.certTrust);
  const maskedUrl = useDrStore(s => s.getMaskedLocalUrl());
  const lastSyncAt = useDrStore(s => s.lastSyncAt);
  const cachedLocalUrl = useDrStore(s => s.cachedLocalUrl);
  const cloudReachable = useCloudReachabilityStore(s => s.cloudReachable);
  const workspaceCode = useSettingsStore(s => s.settings.workspaceCode);

  const provisioned = cachedLocalUrl != null;
  const cert = CERT_COPY[certTrust];

  // Title + lead reason synced with the chip (see ModeIndicator).
  let title: string;
  let lead: string;
  if (provisioned && currentMode === 'local') {
    title = 'On-prem mode';
    lead =
      'Sales are being recorded against your on-prem server. They will reconcile with the cloud once it is back.';
  } else if (currentMode === 'cloud' && cloudReachable === false) {
    title = 'Cloud unreachable';
    lead =
      'Your device can’t reach the Aeris cloud right now. Check your network connection.';
  } else {
    title = 'Cloud (online)';
    lead = 'Connected to the Aeris cloud as normal.';
  }

  const cloudStatusLabel =
    cloudReachable === false ? 'Unreachable' : 'Online';
  const cloudStatusColor =
    cloudReachable === false ? COLORS.warning : COLORS.success;

  return (
    <Modal
      isVisible={visible}
      onBackdropPress={onClose}
      onBackButtonPress={onClose}
      style={styles.modal}>
      <View style={styles.surface}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.reason}>{lead}</Text>

        {/* Cloud — always shown. */}
        <View style={styles.section}>
          <EyebrowLabel>Cloud</EyebrowLabel>
          <Row
            label="Status"
            value={cloudStatusLabel}
            valueColor={cloudStatusColor}
          />
          <Row
            label="Workspace"
            value={workspaceCode || 'Not paired'}
          />
        </View>

        {/* On-prem server — always shown, copy differs by provisioned. */}
        <View style={styles.section}>
          <EyebrowLabel>On-prem server</EyebrowLabel>
          {provisioned ? (
            <>
              <Row label="Address" value={maskedUrl ?? '—'} />
              <Row label="Last sync" value={formatLastSync(lastSyncAt)} />
              <Row
                label="Identity"
                value={cert.label}
                valueColor={cert.color}
              />
            </>
          ) : (
            <Text style={styles.hintLine}>
              Not set up. On-prem failover isn’t configured for this device
              yet — your shop is running cloud-only.
            </Text>
          )}
        </View>

        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeText}>Close</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}): React.ReactElement {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[styles.rowValue, valueColor ? {color: valueColor} : null]}
        numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  modal: {justifyContent: 'flex-end', margin: 0},
  surface: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  title: {
    fontSize: FONT_SIZE.xl,
    fontFamily: FONT_FAMILY.bold,
    color: COLORS.navy,
  },
  reason: {
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.regular,
    color: COLORS.textMuted,
    marginTop: SPACING.xs,
    lineHeight: 20,
  },
  section: {marginTop: SPACING.lg},
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 36,
    gap: SPACING.md,
  },
  rowLabel: {
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    color: COLORS.textMuted,
  },
  rowValue: {
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
    color: COLORS.navy,
    flexShrink: 1,
    textAlign: 'right',
  },
  hintLine: {
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.regular,
    color: COLORS.textMuted,
    marginTop: SPACING.sm,
    lineHeight: 18,
  },
  closeBtn: {
    marginTop: SPACING.lg,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
  },
});
