import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  BarChart3,
  Home,
  ShoppingCart,
  Package,
  Users,
  Receipt,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { COLORS, FONT_SIZE, SPACING } from '../theme/tokens';
import { useCartStore } from '../stores/cartStore';
import { useSettingsStore } from '../stores/settingsStore';
import logoUrl from '../assets/logo.png';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: Home },
  { to: '/dashboard/eod', label: 'Day end', icon: BarChart3 },
  { to: '/pos', label: 'POS', icon: ShoppingCart },
  { to: '/items', label: 'Items', icon: Package },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/transactions', label: 'Transactions', icon: Receipt },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar(): React.ReactElement {
  // Subscribe to the derived count so the badge updates on every cart change.
  const cartItemCount = useCartStore((s) => s.getItemCount());
  // §14.7 Q10: the Z-report ("Day end") is cloud-only by construction — the
  // NAS never serves it (DirectClient has no getDailyZReport, the Direct
  // dispatch refuses sales.daily-summary). Hide the nav entry in Direct mode
  // so the cashier isn't routed to a screen that can only 400.
  const isDirectMode = useSettingsStore(
    (s) => s.settings.connectionMode === 'direct',
  );
  const nav = isDirectMode
    ? NAV.filter((item) => item.to !== '/dashboard/eod')
    : NAV;
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
      {nav.map((item) => {
        const Icon = item.icon;
        const showBadge = item.to === '/pos' && cartItemCount > 0;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => (isActive ? 'aeris-nav-active' : undefined)}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: SPACING.sm,
              padding: `${SPACING.sm}px ${SPACING.md}px`,
              borderRadius: 8,
              color: COLORS.textOnDark,
              textDecoration: 'none',
              fontSize: FONT_SIZE.md,
              fontWeight: isActive ? 600 : 400,
            })}
          >
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <Icon size={18} aria-hidden />
              {showBadge ? (
                <span
                  aria-label={`${cartItemCount} ${cartItemCount === 1 ? 'item' : 'items'} in cart`}
                  style={{
                    position: 'absolute',
                    top: -8,
                    right: -10,
                    minWidth: 18,
                    height: 18,
                    padding: '0 5px',
                    borderRadius: 9,
                    background: COLORS.crimson,
                    color: COLORS.white,
                    fontSize: 11,
                    fontWeight: 700,
                    lineHeight: '18px',
                    textAlign: 'center',
                    boxSizing: 'border-box',
                  }}
                >
                  {cartItemCount}
                </span>
              ) : null}
            </span>
            <span style={{ whiteSpace: 'nowrap' }}>{item.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
