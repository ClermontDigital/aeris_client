import React from 'react';
import { COLORS, SPACING, FONT_SIZE, BORDER_RADIUS } from '../theme/tokens';

export type StatCardTone = 'default' | 'warning' | 'danger';

export interface StatCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  tone?: StatCardTone;
}

// Phase A — extracted from DashboardScreen so list pages can share the
// same surface treatment + token-driven typography.
export function StatCard({
  label,
  value,
  sublabel,
  tone = 'default',
}: StatCardProps): React.ReactElement {
  const valueColor =
    tone === 'danger' ? COLORS.crimson : tone === 'warning' ? COLORS.warning : COLORS.text;

  return (
    <div
      className="aeris-card"
      style={{
        background: COLORS.surface,
        borderRadius: BORDER_RADIUS.lg,
        border: `1px solid ${COLORS.surfaceBorder}`,
        padding: SPACING.lg,
        display: 'flex',
        flexDirection: 'column',
        gap: SPACING.xs,
      }}
    >
      <div
        style={{
          color: COLORS.textMuted,
          fontSize: FONT_SIZE.sm,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        }}
      >
        {label}
      </div>
      <div style={{ color: valueColor, fontSize: FONT_SIZE.title, fontWeight: 700 }}>
        {value}
      </div>
      {sublabel ? (
        <div style={{ color: COLORS.textMuted, fontSize: FONT_SIZE.sm }}>{sublabel}</div>
      ) : null}
    </div>
  );
}
