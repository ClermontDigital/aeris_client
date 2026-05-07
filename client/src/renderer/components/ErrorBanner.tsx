import React from 'react';
import { COLORS, BORDER_RADIUS, SPACING } from '../theme/tokens';

interface Props {
  message: string;
  onDismiss?: () => void;
  tone?: 'error' | 'warning' | 'info';
}

const toneColors: Record<NonNullable<Props['tone']>, { bg: string; border: string; fg: string }> = {
  error: { bg: '#fde7e9', border: COLORS.crimson, fg: COLORS.crimsonDark },
  warning: { bg: '#fef3c7', border: COLORS.warning, fg: '#78350f' },
  info: { bg: COLORS.creamLight, border: COLORS.surfaceBorder, fg: COLORS.text },
};

export function ErrorBanner({ message, onDismiss, tone = 'error' }: Props): React.ReactElement {
  const palette = toneColors[tone];
  return (
    <div
      role="alert"
      style={{
        padding: SPACING.sm + 'px ' + SPACING.md + 'px',
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: BORDER_RADIUS.md,
        color: palette.fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: SPACING.md,
      }}
    >
      <span>{message}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          style={{
            background: 'transparent',
            border: 0,
            color: palette.fg,
            fontSize: 18,
            lineHeight: 1,
            padding: 0,
          }}
          aria-label="Dismiss"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
