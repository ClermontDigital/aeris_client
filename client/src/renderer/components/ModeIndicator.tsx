import React from 'react';
import { COLORS, FONT_SIZE, SPACING, BORDER_RADIUS } from '../theme/tokens';
import { useSettingsStore } from '../stores/settingsStore';

// ModeIndicator (Electron renderer) — the §19.3 cloud-vs-in-store authority
// chip. Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §19.3.
//
// v2 shipped relay-only; the DR Warm-Failover project adds Direct/LAN mode, so
// the cashier needs the same persistent "which authority am I selling against"
// readout the mobile client has. M1 derives the mode straight from the
// configured connectionMode (the routing-cascade-driven 'switching'/'offline'
// transitions are the mobile-parity M2 work once the desktop reachability
// signal + routing engine land here too).

type DesktopMode = 'cloud' | 'local';

const GLYPH: Record<DesktopMode, string> = {
  cloud: '☁️',
  local: '🏪',
};

const LABEL: Record<DesktopMode, string> = {
  cloud: 'Cloud',
  local: 'In-store',
};

const DOT: Record<DesktopMode, string> = {
  cloud: COLORS.navyLight,
  local: COLORS.success,
};

export function ModeIndicator(): React.ReactElement {
  const connectionMode = useSettingsStore((s) => s.settings.connectionMode);
  const mode: DesktopMode = connectionMode === 'direct' ? 'local' : 'cloud';

  return (
    <span
      title={
        mode === 'local'
          ? 'In-store mode — selling against the on-prem server. Sales reconcile to the cloud later.'
          : 'Cloud mode — connected to the Aeris cloud.'
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: SPACING.xs,
        padding: `2px ${SPACING.sm}px`,
        background: COLORS.creamLight,
        border: `1px solid ${COLORS.surfaceBorder}`,
        borderRadius: BORDER_RADIUS.sm,
        fontSize: FONT_SIZE.sm,
        fontWeight: 600,
        color: COLORS.text,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          background: DOT[mode],
        }}
      />
      <span aria-hidden>{GLYPH[mode]}</span>
      <span>{LABEL[mode]}</span>
    </span>
  );
}
