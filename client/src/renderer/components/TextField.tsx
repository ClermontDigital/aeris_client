import React from 'react';
import { COLORS, BORDER_RADIUS, FONT_SIZE, SPACING } from '../theme/tokens';

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  errorText?: string;
  helperText?: string;
}

export function TextField({
  label,
  errorText,
  helperText,
  id,
  style,
  ...rest
}: Props): React.ReactElement {
  const inputId = id ?? `tf-${rest.name ?? Math.random().toString(36).slice(2, 8)}`;
  const hasError = !!errorText;
  return (
    <label
      htmlFor={inputId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: SPACING.xs,
        fontSize: FONT_SIZE.sm,
        color: COLORS.text,
      }}
    >
      {label ? <span style={{ fontWeight: 600 }}>{label}</span> : null}
      <input
        id={inputId}
        {...rest}
        style={{
          padding: `${SPACING.sm}px ${SPACING.md}px`,
          background: COLORS.inputBg,
          border: `1px solid ${hasError ? COLORS.danger : COLORS.inputBorder}`,
          borderRadius: BORDER_RADIUS.md,
          fontSize: FONT_SIZE.md,
          color: COLORS.text,
          outline: 'none',
          ...style,
        }}
      />
      {errorText ? (
        <span style={{ color: COLORS.danger }}>{errorText}</span>
      ) : helperText ? (
        <span style={{ color: COLORS.textMuted }}>{helperText}</span>
      ) : null}
    </label>
  );
}
