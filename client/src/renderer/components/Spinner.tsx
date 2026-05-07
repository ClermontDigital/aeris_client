import React from 'react';
import { COLORS, SPACING } from '../theme/tokens';

interface Props {
  label?: string;
  size?: number;
}

export function Spinner({ label, size = 24 }: Props): React.ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: SPACING.sm,
        color: COLORS.textMuted,
      }}
    >
      <div
        aria-hidden
        style={{
          width: size,
          height: size,
          border: `3px solid ${COLORS.surfaceBorder}`,
          borderTopColor: COLORS.accent,
          borderRadius: '50%',
          animation: 'aeris-spin 0.8s linear infinite',
        }}
      />
      {label ? <span>{label}</span> : null}
      <style>
        {`@keyframes aeris-spin { to { transform: rotate(360deg); } }`}
      </style>
    </div>
  );
}
