import React from 'react';
import { COLORS, BORDER_RADIUS, FONT_SIZE, SPACING } from '../theme/tokens';

interface Props {
  value: string;
  maxLength: number;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}

const KEYS: Array<{ label: string; value?: string; action?: 'backspace' }> = [
  { label: '1', value: '1' },
  { label: '2', value: '2' },
  { label: '3', value: '3' },
  { label: '4', value: '4' },
  { label: '5', value: '5' },
  { label: '6', value: '6' },
  { label: '7', value: '7' },
  { label: '8', value: '8' },
  { label: '9', value: '9' },
  { label: '', value: undefined },
  { label: '0', value: '0' },
  { label: '⌫', action: 'backspace' },
];

// Numeric keypad. Self-contained — touch-friendly buttons, dot indicators
// for the current entry length, and physical keyboard support so a desk
// user can type 1234 with the number row.
export function PinPad({
  value,
  maxLength,
  onChange,
  onSubmit,
  disabled = false,
  ariaLabel = 'PIN pad',
}: Props): React.ReactElement {
  const handleDigit = (d: string) => {
    if (disabled) return;
    if (value.length >= maxLength) return;
    onChange(value + d);
  };
  const handleBackspace = () => {
    if (disabled) return;
    onChange(value.slice(0, -1));
  };

  // Keyboard listener so arrows / numbers / backspace / enter all work.
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (disabled) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Enter' && onSubmit) {
        e.preventDefault();
        onSubmit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, disabled]);

  return (
    <div role="group" aria-label={ariaLabel} style={{ display: 'flex', flexDirection: 'column', gap: SPACING.md, alignItems: 'center' }}>
      {/* dots */}
      <div style={{ display: 'flex', gap: SPACING.sm }} aria-hidden>
        {Array.from({ length: maxLength }).map((_, i) => (
          <div
            key={i}
            style={{
              width: 14,
              height: 14,
              borderRadius: BORDER_RADIUS.full,
              border: `2px solid ${COLORS.surfaceBorder}`,
              background: i < value.length ? COLORS.accent : 'transparent',
            }}
          />
        ))}
      </div>
      {/* keypad grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 72px)',
          gap: SPACING.sm,
        }}
      >
        {KEYS.map((k, idx) => {
          if (!k.value && !k.action) {
            return <div key={idx} />;
          }
          const onClick = k.action === 'backspace' ? handleBackspace : () => handleDigit(k.value as string);
          const label = k.action === 'backspace' ? 'Backspace' : `Digit ${k.value}`;
          return (
            <button
              key={idx}
              type="button"
              onClick={onClick}
              aria-label={label}
              disabled={disabled}
              style={{
                width: 72,
                height: 72,
                borderRadius: BORDER_RADIUS.full,
                background: COLORS.surface,
                border: `1px solid ${COLORS.surfaceBorder}`,
                color: COLORS.text,
                fontSize: FONT_SIZE.xl,
                fontWeight: 600,
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              {k.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
