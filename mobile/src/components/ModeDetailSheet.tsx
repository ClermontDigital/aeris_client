import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import Modal from 'react-native-modal';
import {COLORS, FONT_FAMILY, FONT_SIZE, SPACING} from '../constants/theme';
import {useRoutingDecision} from '../hooks/useRoutingDecision';
import {useDrStore} from '../stores/drStore';
import {useFailoverAbortStore} from '../stores/failoverAbortStore';
import EyebrowLabel from './EyebrowLabel';
import type {CertTrust, RoutingMode} from '../types/dr.types';
import type {RoutingReason} from '../services/routingDecisionService';

// ModeDetailSheet — the §19.3 tap-through detail for the ModeIndicator.
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §19.3, §17.4, §18.
//
// Surfaces: mode, reason, last-sync, masked NAS address, the §17.4 manual
// switch / abort-to-manual controls, and the §18 cert-trust indicator. The
// actual mode SWITCH (re-auth against the NAS) stays in the existing Settings
// flow (§14.7 copy); this sheet exposes the operator affordances around it.

const MODE_TITLE: Record<RoutingMode, string> = {
  cloud: 'Cloud (online)',
  local: 'In-store mode (NAS)',
  switching: 'Switching…',
  offline: 'Offline / degraded',
};

const REASON_COPY: Record<RoutingReason, string> = {
  'mid-transaction-defer': 'Holding the current mode until the sale completes.',
  'directive-local': 'Planned cutover — your shop was switched to in-store mode.',
  'cloud-primary': 'Connected to the Aeris cloud as normal.',
  'outage-prompt': 'Cloud unreachable — you can switch to in-store mode to keep selling.',
  'degraded-fail-closed':
    'Neither the cloud nor a trusted in-store server is reachable. Look-ups use cached data; recording sales is paused.',
  'failback-hold': 'Cloud is back — staying in-store briefly to finish syncing.',
  'failback-ready': 'Cloud is back and stable — returning to cloud mode.',
};

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
  const {currentMode, reason} = useRoutingDecision();
  const certTrust = useDrStore(s => s.certTrust);
  const maskedUrl = useDrStore(s => s.getMaskedLocalUrl());
  const lastSyncAt = useDrStore(s => s.lastSyncAt);
  const cachedLocalUrl = useDrStore(s => s.cachedLocalUrl);

  const manualMode = useFailoverAbortStore(s => s.manualMode);
  const nasUnavailable = useFailoverAbortStore(s => s.nasUnavailable);
  const returnToManual = useFailoverAbortStore(s => s.returnToManual);
  const clearManual = useFailoverAbortStore(s => s.clearManual);

  const cert = CERT_COPY[certTrust];

  return (
    <Modal
      isVisible={visible}
      onBackdropPress={onClose}
      onBackButtonPress={onClose}
      style={styles.modal}>
      <View style={styles.surface}>
        <Text style={styles.title}>{MODE_TITLE[currentMode]}</Text>
        <Text style={styles.reason}>{REASON_COPY[reason]}</Text>

        <View style={styles.section}>
          <EyebrowLabel>Status</EyebrowLabel>
          <Row label="Last sync" value={formatLastSync(lastSyncAt)} />
          <Row
            label="In-store server"
            value={maskedUrl ?? 'Not configured'}
          />
          <Row
            label="Server identity"
            value={cert.label}
            valueColor={cert.color}
          />
        </View>

        {/* §17.4 manual / abort controls. "Return to manual" freezes write
            actions (paper fallback); "Resume" clears it once recovered. */}
        <View style={styles.section}>
          <EyebrowLabel>Controls</EyebrowLabel>
          {nasUnavailable ? (
            <Text style={styles.warnLine}>
              The in-store server is unreachable. Use manual / paper until it
              returns.
            </Text>
          ) : null}
          {manualMode ? (
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => {
                clearManual();
                onClose();
              }}
              accessibilityRole="button">
              <Text style={styles.secondaryText}>Resume recording sales</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.dangerBtn}
              onPress={() => {
                returnToManual();
                onClose();
              }}
              accessibilityRole="button"
              accessibilityLabel="Return to manual or paper">
              <Text style={styles.dangerText}>Return to manual / paper</Text>
            </TouchableOpacity>
          )}
          {/* The mode SWITCH itself (re-auth against the NAS) lives in
              Settings → Connection per the §14.7 copy. We point there rather
              than duplicate the auth flow here. */}
          {!cachedLocalUrl ? (
            <Text style={styles.hintLine}>
              No in-store server address has been delivered to this device yet.
              You can enter one manually in Settings.
            </Text>
          ) : null}
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
  warnLine: {
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.regular,
    color: COLORS.warningText,
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
    lineHeight: 18,
  },
  hintLine: {
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.regular,
    color: COLORS.textMuted,
    marginTop: SPACING.sm,
    lineHeight: 18,
  },
  dangerBtn: {
    marginTop: SPACING.sm,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.destructive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerText: {
    color: COLORS.destructive,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.semibold,
  },
  secondaryBtn: {
    marginTop: SPACING.sm,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    color: COLORS.navy,
    fontSize: FONT_SIZE.md,
    fontFamily: FONT_FAMILY.medium,
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
