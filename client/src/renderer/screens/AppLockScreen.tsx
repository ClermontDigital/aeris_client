import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { useAppLockStore } from '../stores/appLockStore';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZE } from '../theme/tokens';

// Phase 2 placeholder. Phase 3 builds the real PIN pad + cooldown
// timer + biometric prompt (post-2.0) here.

export function AppLockScreen(): React.ReactElement {
  const navigate = useNavigate();
  const unlock = useAppLockStore((s) => s.unlock);

  const onUnlock = () => {
    unlock();
    navigate('/');
  };

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: COLORS.background,
      }}
    >
      <div
        style={{
          width: 360,
          background: COLORS.surface,
          padding: SPACING.xl,
          borderRadius: BORDER_RADIUS.lg,
          border: `1px solid ${COLORS.surfaceBorder}`,
          display: 'flex',
          flexDirection: 'column',
          gap: SPACING.md,
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: FONT_SIZE.xxl, fontWeight: 700, color: COLORS.text }}>
          Locked
        </div>
        <p style={{ color: COLORS.textMuted, margin: 0 }}>
          Phase 3 will build the PIN pad here.
        </p>
        <Button onClick={onUnlock} fullWidth>
          Unlock (placeholder)
        </Button>
      </div>
    </div>
  );
}
