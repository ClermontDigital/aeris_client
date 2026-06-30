import React from 'react';
import { COLORS, FONT_SIZE, SPACING, BORDER_RADIUS } from '../theme/tokens';
import { useDrStore } from '../stores/drStore';
import type { DrMode } from '../../shared-types/ipc';

// ModeIndicator (Electron renderer) — the §19.3 cloud-vs-in-store authority
// chip, brought up to mobile parity (M3-E). Source of truth:
// docs/PROJECT_DR_NAS_WARM_FAILOVER.md §19.3 + PROJECT_DR_M3_BUILD_PLAN.md §M3-E.
//
// v2 shipped relay-only; M1 added a 2-state (cloud/local) chip derived straight
// from connectionMode. M3-E now reads the live DR failover state from main
// (failoverOrchestrator), so the chip reflects the same four states as mobile:
//   cloud     ☁️  relay/cloud authority (normal)
//   local     🏪  Direct/LAN against the NAS
//   switching 🔄  a mode-switch (clear-session + re-auth) is in flight
//   offline   🔴  degraded: neither cloud nor a usable NAS reachable (fail-closed)

const GLYPH: Record<DrMode, string> = {
  cloud: '☁️',
  local: '🏪',
  switching: '🔄',
  offline: '🔴',
};

const LABEL: Record<DrMode, string> = {
  cloud: 'Cloud',
  local: 'In-store',
  switching: 'Switching…',
  offline: 'Offline',
};

const DOT: Record<DrMode, string> = {
  cloud: COLORS.navyLight,
  local: COLORS.success,
  switching: COLORS.warning,
  offline: COLORS.danger,
};

const TITLE: Record<DrMode, string> = {
  cloud: 'Cloud mode — connected to the Aeris cloud.',
  local:
    'In-store mode — selling against the on-prem server. Sales reconcile to the cloud later.',
  switching: 'Switching connection — signing in to the new server.',
  offline:
    'Offline — neither the cloud nor a trusted in-store server is reachable. Selling is paused until one returns.',
};

export function ModeIndicator(): React.ReactElement {
  const mode = useDrStore((s) => s.mode);

  return (
    <span
      title={TITLE[mode]}
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
