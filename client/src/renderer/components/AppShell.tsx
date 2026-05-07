import React from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { COLORS, SPACING } from '../theme/tokens';

export function AppShell(): React.ReactElement {
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
        <TopBar />
        <main
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
