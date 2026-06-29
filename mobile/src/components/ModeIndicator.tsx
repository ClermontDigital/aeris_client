import React, {useState} from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {COLORS, FONT_FAMILY, FONT_SIZE} from '../constants/theme';
import {useRoutingDecision} from '../hooks/useRoutingDecision';
import {useDrStore} from '../stores/drStore';
import {ModeDetailSheet} from './ModeDetailSheet';
import type {RoutingMode} from '../types/dr.types';

// ModeIndicator — the persistent §19.3 cloud-vs-local authority chip.
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §19.3, §21.
//
// Anchored on the right, just inboard of the gear, so the two header
// affordances cluster together and the wordmark sits unobstructed on the left.
//
// Always-visible so the cashier knows which authority they're selling against
// (and that in-store sales will reconcile later). Tappable → ModeDetailSheet.
//
// In M1 the indicator is a PURE READOUT of the routing engine's current mode;
// it does not own the switch. The detail sheet hosts the §17.4 abort/manual
// controls and the §18 cert-trust readout.

// Emoji glyph per §19.3. Kept as the literal glyphs the doc specifies so the
// chip reads identically to the spec across phone + tablet.
const GLYPH: Record<RoutingMode, string> = {
  cloud: '☁️',
  local: '🏪',
  switching: '🔄',
  offline: '🔴',
};

const SHORT_LABEL: Record<RoutingMode, string> = {
  cloud: 'Cloud',
  local: 'In-store',
  switching: 'Switching',
  offline: 'Offline',
};

// Accent dot colour per mode — a small status pip alongside the glyph for
// a11y (colour is secondary to the glyph + label, never the sole signal).
const DOT: Record<RoutingMode, string> = {
  cloud: COLORS.blue,
  local: COLORS.success,
  switching: COLORS.warning,
  offline: COLORS.danger,
};

interface Props {
  // Absolute-position offset so the chip lines up with the gear's
  // `top: insets.top + 36` (passed by AppTabs).
  topOffset: number;
}

export function ModeIndicator({topOffset}: Props): React.ReactElement {
  const [sheetOpen, setSheetOpen] = useState(false);
  const {currentMode} = useRoutingDecision();
  // A live "switching" override: when the cached target is being (re)probed we
  // show the spinner glyph regardless of the steady-state mode.
  const cacheStatus = useDrStore(s => s.cacheStatus);
  const mode: RoutingMode =
    cacheStatus === 'pending' && currentMode === 'local'
      ? 'switching'
      : currentMode;

  return (
    <>
      <TouchableOpacity
        onPress={() => setSheetOpen(true)}
        style={[styles.chip, {top: topOffset}]}
        accessibilityRole="button"
        accessibilityLabel={`Connection mode: ${SHORT_LABEL[mode]}. Tap for details.`}
        hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
        <View style={styles.iconRow}>
          <View style={[styles.dot, {backgroundColor: DOT[mode]}]} />
          <Text style={styles.glyph} allowFontScaling={false}>
            {GLYPH[mode]}
          </Text>
        </View>
        <Text style={styles.label} numberOfLines={1} allowFontScaling={false}>
          {SHORT_LABEL[mode]}
        </Text>
      </TouchableOpacity>
      <ModeDetailSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  // Anchored to the right edge, just inboard of gearBtn (which is `right:12`
  // + 44 wide → its left edge is at `right:56`). The chip's right edge sits
  // at `right:60` so there's a 4px gap between the two affordances.
  // Two-line stack: dot+glyph on top, label below, both centred under each
  // other. Absolutely positioned so it never disturbs the centred wordmark.
  chip: {
    position: 'absolute',
    right: 60,
    height: 44,
    maxWidth: 96,
    flexDirection: 'column',
    alignItems: 'center',
    paddingHorizontal: 6,
    zIndex: 3,
  },
  // Top half — dot + glyph. Exactly 22px so the label below also gets 22px.
  iconRow: {
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  glyph: {
    fontSize: 14,
  },
  // Bottom half — the small word. lineHeight 22 centres the glyph in a 22-tall
  // line box so the label visually occupies exactly half the chip.
  label: {
    color: COLORS.navy,
    fontSize: FONT_SIZE.sm,
    fontFamily: FONT_FAMILY.medium,
    lineHeight: 22,
  },
});
