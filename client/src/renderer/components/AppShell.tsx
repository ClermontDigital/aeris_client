import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { UpdateBanner } from './UpdateBanner';
import { FailoverBanner } from './FailoverBanner';
import { useDrActivityReporter } from '../hooks/useDrActivityReporter';
import { COLORS, SPACING } from '../theme/tokens';

export function AppShell(): React.ReactElement {
  // M3-E: report cart/screen to main so an auto-failover never fires mid-sale.
  useDrActivityReporter();
  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        background: COLORS.background,
      }}
    >
      <Sidebar />
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        <UpdateBanner />
        <FailoverBanner />
        <TopBar />
        <main
          className="aeris-fade-in"
          style={{
            flex: 1,
            overflow: 'auto',
            padding: SPACING.lg,
          }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
