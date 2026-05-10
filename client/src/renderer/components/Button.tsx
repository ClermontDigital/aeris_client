import React from 'react';
import { COLORS, BORDER_RADIUS, FONT_SIZE, SPACING } from '../theme/tokens';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  fullWidth?: boolean;
}

function variantStyles(variant: Variant, disabled: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    border: '1px solid transparent',
    color: COLORS.textOnDark,
    fontWeight: 600,
    opacity: disabled ? 0.5 : 1,
  };
  switch (variant) {
    case 'primary':
      return { ...base, background: COLORS.accent };
    case 'danger':
      return { ...base, background: COLORS.danger };
    case 'secondary':
      return {
        ...base,
        background: COLORS.surface,
        color: COLORS.text,
        border: `1px solid ${COLORS.surfaceBorder}`,
      };
    case 'ghost':
      return {
        ...base,
        background: 'transparent',
        color: COLORS.text,
        border: '1px solid transparent',
      };
  }
}

export function Button({
  children,
  variant = 'primary',
  loading,
  fullWidth,
  disabled,
  style,
  ...rest
}: Props): React.ReactElement {
  const isDisabled = disabled || loading;
  return (
    <button
      type={rest.type ?? 'button'}
      disabled={isDisabled}
      {...rest}
      style={{
        ...variantStyles(variant, !!isDisabled),
        padding: `${SPACING.sm}px ${SPACING.md}px`,
        borderRadius: BORDER_RADIUS.md,
        fontSize: FONT_SIZE.md,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        width: fullWidth ? '100%' : undefined,
        transition: 'background 120ms ease, transform 120ms ease',
        ...style,
      }}
    >
      {loading ? '…' : children}
    </button>
  );
}
