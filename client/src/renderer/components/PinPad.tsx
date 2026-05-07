import React from 'react';
import { SPACING } from '../theme/tokens';

interface Props {
  value: string;
  maxLength: number;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}

type Key =
  | { kind: 'digit'; value: string }
  | { kind: 'clear' }
  | { kind: 'backspace' };

const KEYS: Key[] = [
  { kind: 'digit', value: '1' },
  { kind: 'digit', value: '2' },
  { kind: 'digit', value: '3' },
  { kind: 'digit', value: '4' },
  { kind: 'digit', value: '5' },
  { kind: 'digit', value: '6' },
  { kind: 'digit', value: '7' },
  { kind: 'digit', value: '8' },
  { kind: 'digit', value: '9' },
  { kind: 'clear' },
  { kind: 'digit', value: '0' },
  { kind: 'backspace' },
];

// Numeric keypad with a balanced [Clear · 0 · ⌫] bottom row so all three
// columns carry weight. Hover / press / focus visuals live in
// theme/global.css under .pinpad-key so the pseudo-class transitions are
// real CSS, not React state churn. Physical keyboard input is wired up
// so a desk user can type 1234 with the number row.
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
  const handleClear = () => {
    if (disabled) return;
    onChange('');
  };

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (disabled) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleClear();
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
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: SPACING.lg,
        alignItems: 'center',
      }}
    >
      <div
        style={{ display: 'flex', gap: 12 }}
        aria-hidden
        aria-live="polite"
        aria-atomic="true"
      >
        {Array.from({ length: maxLength }).map((_, i) => (
          <div
            key={i}
            className={`pinpad-dot${i < value.length ? ' pinpad-dot--filled' : ''}`}
          />
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 64px)',
          gap: 14,
          justifyContent: 'center',
        }}
      >
        {KEYS.map((k, idx) => {
          if (k.kind === 'digit') {
            return (
              <button
                key={idx}
                type="button"
                className="pinpad-key"
                onClick={() => handleDigit(k.value)}
                aria-label={`Digit ${k.value}`}
                disabled={disabled}
              >
                {k.value}
              </button>
            );
          }
          if (k.kind === 'clear') {
            return (
              <button
                key={idx}
                type="button"
                className="pinpad-key pinpad-key--text"
                onClick={handleClear}
                aria-label="Clear PIN"
                disabled={disabled || value.length === 0}
              >
                Clear
              </button>
            );
          }
          return (
            <button
              key={idx}
              type="button"
              className="pinpad-key pinpad-key--icon"
              onClick={handleBackspace}
              aria-label="Backspace"
              disabled={disabled || value.length === 0}
            >
              ⌫
            </button>
          );
        })}
      </div>
    </div>
  );
}
