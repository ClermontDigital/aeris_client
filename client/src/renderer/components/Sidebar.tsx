import React from 'react';
import { NavLink } from 'react-router-dom';
import { COLORS, FONT_SIZE, SPACING } from '../theme/tokens';

interface NavItem {
  to: string;
  label: string;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/settings', label: 'Settings' },
];

export function Sidebar(): React.ReactElement {
  return (
    <nav
      aria-label="Primary navigation"
      style={{
        width: 220,
        flexShrink: 0,
        background: COLORS.toolbarBg,
        color: COLORS.textOnDark,
        padding: SPACING.md,
        display: 'flex',
        flexDirection: 'column',
        gap: SPACING.xs,
      }}
    >
      <div
        style={{
          fontSize: FONT_SIZE.xl,
          fontWeight: 700,
          marginBottom: SPACING.lg,
          letterSpacing: 0.5,
        }}
      >
        Aeris
      </div>
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          style={({ isActive }) => ({
            display: 'block',
            padding: `${SPACING.sm}px ${SPACING.md}px`,
            borderRadius: 8,
            background: isActive ? COLORS.toolbarBtnHover : 'transparent',
            color: COLORS.textOnDark,
            textDecoration: 'none',
            fontSize: FONT_SIZE.md,
            fontWeight: isActive ? 600 : 400,
          })}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
