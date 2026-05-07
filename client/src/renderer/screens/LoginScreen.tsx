import React, { useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { Button } from '../components/Button';
import { TextField } from '../components/TextField';
import { ErrorBanner } from '../components/ErrorBanner';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZE } from '../theme/tokens';

// Phase 2 placeholder. Phase 3 builds the real workspace + email +
// password form with validation per the plan's Auth + lock UX section.

export function LoginScreen(): React.ReactElement {
  const errorKind = useAuthStore((s) => s.errorKind);
  const login = useAuthStore((s) => s.login);
  const [busy, setBusy] = useState(false);

  // Placeholder "Continue" pretends to authenticate against a stub
  // workspace so a developer running `npm run dev` can poke around
  // the AppShell without a live relay. Phase 3 wires the full form.
  const onContinue = async () => {
    setBusy(true);
    try {
      await login({ workspaceCode: 'demo', email: 'demo@aeris.local', password: 'demo' });
    } finally {
      setBusy(false);
    }
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
          width: 400,
          background: COLORS.surface,
          padding: SPACING.xl,
          borderRadius: BORDER_RADIUS.lg,
          border: `1px solid ${COLORS.surfaceBorder}`,
          display: 'flex',
          flexDirection: 'column',
          gap: SPACING.md,
        }}
      >
        <div style={{ fontSize: FONT_SIZE.title, fontWeight: 700, color: COLORS.text }}>
          Aeris
        </div>
        <p style={{ color: COLORS.textMuted, margin: 0 }}>
          Phase 3 will build the workspace + email + password form here.
        </p>
        {errorKind ? (
          <ErrorBanner message={`Login error: ${errorKind}`} />
        ) : null}
        <TextField label="Workspace code" placeholder="demo" disabled />
        <TextField label="Email" placeholder="you@example.com" disabled />
        <TextField label="Password" type="password" disabled />
        <Button onClick={onContinue} loading={busy} fullWidth>
          Continue (placeholder)
        </Button>
      </div>
    </div>
  );
}
