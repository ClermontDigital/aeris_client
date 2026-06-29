import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Search } from 'lucide-react';
import { COLORS, FONT_SIZE, SPACING, BORDER_RADIUS } from '../theme/tokens';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { ModeIndicator } from './ModeIndicator';

export function TopBar(): React.ReactElement {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const workspaceCode = useSettingsStore((s) => s.settings.workspaceCode);
  const [globalQuery, setGlobalQuery] = useState('');

  const onLock = () => navigate('/lock');
  const onLogout = async () => {
    await logout();
  };

  const onSubmitSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = globalQuery.trim();
    if (!q) return;
    // Items is the only screen that consumes ?q= today; B-phase work
    // can broaden this to a real global search.
    navigate(`/items?q=${encodeURIComponent(q)}`);
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
        {/* §19.3 DR mode indicator — the cloud-vs-in-store authority chip.
            v2 was relay-only; the DR project adds Direct/LAN mode, so the
            cashier needs the same persistent readout the mobile client has. */}
        <ModeIndicator />
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

      <form
        role="search"
        onSubmit={onSubmitSearch}
        style={{
          flex: 1,
          maxWidth: 420,
          display: 'flex',
          alignItems: 'center',
          gap: SPACING.xs,
          background: COLORS.creamLight,
          border: `1px solid ${COLORS.surfaceBorder}`,
          borderRadius: BORDER_RADIUS.md,
          padding: `0 ${SPACING.sm}px`,
          height: 32,
        }}
      >
        <Search size={14} aria-hidden color={COLORS.textMuted} />
        <input
          type="search"
          value={globalQuery}
          onChange={(e) => setGlobalQuery(e.target.value)}
          placeholder="Search items…"
          aria-label="Global search"
          style={{
            flex: 1,
            border: 0,
            background: 'transparent',
            color: COLORS.text,
            fontSize: FONT_SIZE.sm,
            outline: 'none',
          }}
        />
      </form>

      <div style={{ display: 'flex', alignItems: 'center', gap: SPACING.md }}>
        <button
          type="button"
          onClick={() => {
            /* Notifications inbox lands in 2.2 */
          }}
          aria-label="Notifications"
          style={{
            background: 'transparent',
            border: `1px solid ${COLORS.surfaceBorder}`,
            borderRadius: BORDER_RADIUS.md,
            padding: `${SPACING.xs}px ${SPACING.sm}px`,
            color: COLORS.text,
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          <Bell size={16} aria-hidden />
        </button>
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
