import React from 'react';
import { useNavigate } from 'react-router-dom';
import { COLORS, FONT_SIZE, SPACING, BORDER_RADIUS } from '../theme/tokens';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';

export function TopBar(): React.ReactElement {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const workspaceCode = useSettingsStore((s) => s.settings.workspaceCode);

  const onLock = () => navigate('/lock');
  const onLogout = async () => {
    await logout();
  };

  return (
    <header
      style={{
        height: 56,
        flexShrink: 0,
        background: COLORS.surface,
        borderBottom: `1px solid ${COLORS.surfaceBorder}`,
        padding: `0 ${SPACING.lg}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: SPACING.md,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: SPACING.sm,
          fontSize: FONT_SIZE.sm,
          color: COLORS.textMuted,
        }}
      >
        <span>Workspace</span>
        <span
          style={{
            padding: `2px ${SPACING.sm}px`,
            background: COLORS.creamLight,
            border: `1px solid ${COLORS.surfaceBorder}`,
            borderRadius: BORDER_RADIUS.sm,
            color: COLORS.text,
            fontWeight: 600,
          }}
        >
          {workspaceCode || '—'}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: SPACING.md }}>
        {user ? (
          <span style={{ fontSize: FONT_SIZE.sm, color: COLORS.textMuted }}>
            {user.email}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onLock}
          aria-label="Lock"
          style={{
            background: 'transparent',
            border: `1px solid ${COLORS.surfaceBorder}`,
            borderRadius: BORDER_RADIUS.md,
            padding: `${SPACING.xs}px ${SPACING.sm}px`,
            color: COLORS.text,
            fontSize: FONT_SIZE.sm,
          }}
        >
          Lock
        </button>
        <button
          type="button"
          onClick={onLogout}
          style={{
            background: COLORS.accent,
            border: 0,
            borderRadius: BORDER_RADIUS.md,
            padding: `${SPACING.xs}px ${SPACING.md}px`,
            color: COLORS.textOnDark,
            fontSize: FONT_SIZE.sm,
            fontWeight: 600,
          }}
        >
          Log out
        </button>
      </div>
    </header>
  );
}
