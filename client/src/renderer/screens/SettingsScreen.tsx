import React, { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { COLORS, FONT_SIZE, SPACING } from '../theme/tokens';

export function SettingsScreen(): React.ReactElement {
  const settings = useSettingsStore((s) => s.settings);
  const logout = useAuthStore((s) => s.logout);
  const [version, setVersion] = useState<string>('…');

  useEffect(() => {
    void window.aeris.app.version().then(setVersion);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACING.lg, maxWidth: 640 }}>
      <h1 style={{ fontSize: FONT_SIZE.xxl, color: COLORS.text, margin: 0 }}>Settings</h1>
      <p style={{ color: COLORS.textMuted, margin: 0 }}>
        Phase 3 will build me — workspace, relay URL, auto-lock, send diagnostics.
      </p>

      <section
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.surfaceBorder}`,
          borderRadius: 12,
          padding: SPACING.md,
          display: 'flex',
          flexDirection: 'column',
          gap: SPACING.sm,
        }}
      >
        <div>
          <strong>Version:</strong> {version}
        </div>
        <div>
          <strong>Workspace:</strong> {settings.workspaceCode || '—'}
        </div>
        <div>
          <strong>Relay URL:</strong> {settings.relayUrl}
        </div>
      </section>

      <Button variant="danger" onClick={logout} style={{ alignSelf: 'flex-start' }}>
        Log out
      </Button>
    </div>
  );
}
