import React, { useState, useCallback } from 'react';
import { useAppLockStore } from '../stores/appLockStore';
import { Button } from '../components/Button';
import { PinPad } from '../components/PinPad';
import { ErrorBanner } from '../components/ErrorBanner';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZE } from '../theme/tokens';

const PIN_MAX_LENGTH = 6;
const PIN_MIN_LENGTH = 4;

type Step = 'set' | 'confirm';

export function PinSetupScreen(): React.ReactElement {
  const setPinIpc = useAppLockStore((s) => s.setPin);
  const [step, setStep] = useState<Step>('set');
  const [first, setFirst] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onContinueFromSet = () => {
    if (first.length < PIN_MIN_LENGTH) {
      setError(`PIN must be at least ${PIN_MIN_LENGTH} digits.`);
      return;
    }
    setError(null);
    setStep('confirm');
  };

  const onSubmitConfirm = useCallback(async () => {
    if (busy) return;
    if (confirm !== first) {
      setError("PINs didn't match. Try again.");
      setFirst('');
      setConfirm('');
      setStep('set');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await setPinIpc(first);
      if (!result.ok) {
        setError(result.message ?? 'Could not set PIN.');
        setFirst('');
        setConfirm('');
        setStep('set');
      }
      // On ok: appLockStore subscription flips isPinSet=true and the
      // router routes us forward.
    } finally {
      setBusy(false);
    }
  }, [busy, confirm, first, setPinIpc]);

  const value = step === 'set' ? first : confirm;
  const setValue = step === 'set' ? setFirst : setConfirm;

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
          width: 460,
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
          {step === 'set' ? 'Set a PIN' : 'Confirm your PIN'}
        </div>
        <p style={{ color: COLORS.textMuted, margin: 0 }}>
          {step === 'set'
            ? 'Choose a 4–6 digit PIN to unlock Aeris.'
            : 'Re-enter the PIN to confirm.'}
        </p>
        {error ? <ErrorBanner message={error} /> : null}

        <PinPad
          value={value}
          maxLength={PIN_MAX_LENGTH}
          onChange={(v) => {
            setError(null);
            setValue(v);
          }}
          onSubmit={step === 'set' ? onContinueFromSet : onSubmitConfirm}
          disabled={busy}
          ariaLabel={step === 'set' ? 'Set PIN keypad' : 'Confirm PIN keypad'}
        />

        <div style={{ display: 'flex', gap: SPACING.sm, width: '100%' }}>
          {step === 'confirm' ? (
            <Button
              variant="secondary"
              onClick={() => {
                setStep('set');
                setConfirm('');
                setError(null);
              }}
              style={{ flex: 1 }}
            >
              Back
            </Button>
          ) : null}
          <Button
            onClick={step === 'set' ? onContinueFromSet : onSubmitConfirm}
            disabled={value.length < PIN_MIN_LENGTH || busy}
            loading={busy}
            style={{ flex: 1 }}
          >
            {step === 'set' ? 'Continue' : 'Confirm'}
          </Button>
        </div>
      </div>
    </div>
  );
}
