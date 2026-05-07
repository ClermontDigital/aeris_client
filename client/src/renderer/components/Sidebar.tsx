import React from 'react';
import { NavLink } from 'react-router-dom';
import { COLORS, FONT_SIZE, SPACING } from '../theme/tokens';
import logoUrl from '../assets/logo.png';

interface NavItem {
  to: string;
  label: string;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/items', label: 'Items' },
  { to: '/customers', label: 'Customers' },
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
          display: 'flex',
          justifyContent: 'center',
          marginBottom: SPACING.lg,
        }}
      >
        <img
          src={logoUrl}
          alt="Aeris"
          style={{ width: 96, height: 'auto', display: 'block' }}
        />
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
