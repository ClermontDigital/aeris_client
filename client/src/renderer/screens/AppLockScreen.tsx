import React, { useState, useEffect, useCallback } from 'react';
import { useAppLockStore } from '../stores/appLockStore';
import { useAuthStore } from '../stores/authStore';
import { Button } from '../components/Button';
import { PinPad } from '../components/PinPad';
import { ErrorBanner } from '../components/ErrorBanner';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZE } from '../theme/tokens';

const PIN_MAX_LENGTH = 6;
const PIN_MIN_LENGTH = 4;

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AppLockScreen(): React.ReactElement {
  const verifyPin = useAppLockStore((s) => s.verifyPin);
  const lockedOutUntilMs = useAppLockStore((s) => s.lockedOutUntilMs);
  const logout = useAuthStore((s) => s.logout);

  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Tick the clock for the lockout countdown.
  useEffect(() => {
    if (!lockedOutUntilMs) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [lockedOutUntilMs]);

  const inLockout = lockedOutUntilMs != null && lockedOutUntilMs > now;
  const remainingMs = inLockout ? (lockedOutUntilMs as number) - now : 0;

  const onSubmit = useCallback(async () => {
    if (busy) return;
    if (inLockout) return;
    if (pin.length < PIN_MIN_LENGTH) {
      setError(`PIN must be at least ${PIN_MIN_LENGTH} digits.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await verifyPin(pin);
      if (!result.ok) {
        setPin('');
        if (result.lockedOutUntilMs) {
          setError('Too many wrong attempts. Locked.');
        } else {
          const remaining = result.attemptsRemaining ?? 0;
          setError(
            remaining > 0
              ? `Wrong PIN. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
              : 'Wrong PIN.',
          );
        }
      }
      // Successful verify flips locked=false via the store subscription.
    } finally {
      setBusy(false);
    }
  }, [busy, inLockout, pin, verifyPin]);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: COLORS.primary,
        padding: SPACING.lg,
      }}
    >
      <div
        style={{
          width: 420,
          maxWidth: '100%',
          background: COLORS.cream,
          padding: SPACING.xl,
          borderRadius: BORDER_RADIUS.lg,
          border: `1px solid ${COLORS.surfaceBorder}`,
          display: 'flex',
          flexDirection: 'column',
          gap: SPACING.md,
          alignItems: 'center',
          textAlign: 'center',
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ fontSize: FONT_SIZE.xxl, fontWeight: 700, color: COLORS.text }}>
          Locked
        </div>
        <p style={{ color: COLORS.textMuted, margin: 0 }}>
          Enter your PIN to unlock.
        </p>

        {inLockout ? (
          <ErrorBanner
            message={`Too many wrong attempts. Try again in ${formatRemaining(remainingMs)}.`}
            tone="warning"
          />
        ) : error ? (
          <ErrorBanner message={error} />
        ) : null}

        <PinPad
          value={pin}
          maxLength={PIN_MAX_LENGTH}
          onChange={(v) => {
            setError(null);
            setPin(v);
          }}
          onSubmit={onSubmit}
          disabled={busy || inLockout}
          ariaLabel="Unlock PIN keypad"
        />

        <Button
          onClick={onSubmit}
          disabled={busy || inLockout || pin.length < PIN_MIN_LENGTH}
          loading={busy}
          fullWidth
        >
          Unlock
        </Button>

        <Button
          variant="ghost"
          onClick={() => void logout()}
          fullWidth
          style={{ color: COLORS.danger }}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}
