import React from 'react';
import { COLORS, FONT_SIZE, SPACING, BORDER_RADIUS } from '../theme/tokens';
import { useDrStore } from '../stores/drStore';
import type { DrState } from '../../shared-types/ipc';

// FailoverBanner (Electron renderer) — M3-E parity with mobile's
// FailoverBanners. A minimal, non-blocking strip surfacing the DR failover
// situation. Source of truth: docs/PROJECT_DR_M3_BUILD_PLAN.md §M3-E.
//
// Copy branches on autoFailoverEnabled (auto-mode vs the M2 manual prompt):
//   - offline             → fail-closed banner (both directions, any flag).
//   - switching           → transient "switching…" reassurance.
//   - cloud-unreachable + flag OFF + NAS usable → the M2 "switch in Settings"
//     prompt (promptFailover).
//   - cloud-unreachable + flag ON → "switched automatically" reassurance
//     (the orchestrator has/­will auto-swap; mode goes local/switching).
//   - cert mismatch       → security warning (never auto-switches to a
//     spoofed host — fail-closed).
// Steady cloud / steady local with a healthy cloud → no banner.

type BannerTone = 'warning' | 'danger' | 'info';

function resolveBanner(
  s: DrState,
): { tone: BannerTone; text: string } | null {
  // A spoofed NAS is the highest-priority warning — we never silently swap to it.
  if (s.nasCertMismatch && s.cloudReachable === false) {
    return {
      tone: 'danger',
      text:
        'In-store server identity could not be verified — staying off it for safety. ' +
        'Selling is paused until the cloud or a trusted in-store server returns.',
    };
  }

  if (s.mode === 'offline') {
    return {
      tone: 'danger',
      text:
        'Offline — neither the cloud nor a trusted in-store server is reachable. ' +
        'Selling is paused until one returns.',
    };
  }

  if (s.mode === 'switching') {
    return {
      tone: 'info',
      text: 'Switching connection — signing in to the new server…',
    };
  }

  // Cloud unreachable while still on cloud authority.
  if (s.cloudReachable === false && s.mode === 'cloud') {
    if (s.autoFailoverEnabled) {
      return {
        tone: 'warning',
        text:
          'Cloud unreachable — switching to the in-store server automatically.',
      };
    }
    if (s.promptFailover) {
      return {
        tone: 'warning',
        text:
          'Cloud unreachable. You can switch to in-store mode in Settings to keep selling.',
      };
    }
    return {
      tone: 'warning',
      text: 'Cloud unreachable — retrying.',
    };
  }

  // Operating in-store (after an auto/manual switch) — keep a gentle reminder.
  if (s.mode === 'local') {
    return {
      tone: 'info',
      text: s.autoFailoverEnabled
        ? 'Switched to in-store mode automatically. Sales reconcile to the cloud when it returns.'
        : 'In-store mode — sales reconcile to the cloud later.',
    };
  }

  return null;
}

const TONE_BG: Record<BannerTone, string> = {
  warning: '#fffbeb',
  danger: '#fef2f2',
  info: COLORS.creamLight,
};
const TONE_FG: Record<BannerTone, string> = {
  warning: COLORS.warning,
  danger: COLORS.danger,
  info: COLORS.text,
};

export function FailoverBanner(): React.ReactElement | null {
  const dr = useDrStore((s) => s);
  const banner = resolveBanner(dr);
  if (!banner) return null;

  return (
    <div
      role="status"
      style={{
        padding: `${SPACING.sm}px ${SPACING.lg}px`,
        background: TONE_BG[banner.tone],
        borderBottom: `1px solid ${COLORS.surfaceBorder}`,
        color: TONE_FG[banner.tone],
        fontSize: FONT_SIZE.sm,
        fontWeight: 600,
        textAlign: 'center',
      }}
    >
      {banner.text}
    </div>
  );
}
