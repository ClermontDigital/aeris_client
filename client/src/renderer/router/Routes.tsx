import React from 'react';
import { Navigate, Route, Routes as RRRoutes, useLocation } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { LoginScreen } from '../screens/LoginScreen';
import { AppLockScreen } from '../screens/AppLockScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { TransactionListScreen } from '../screens/TransactionListScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { useAuthStore } from '../stores/authStore';
import { useAppLockStore } from '../stores/appLockStore';

// Auth + lock guard.
// - Not authenticated: only /login is reachable.
// - Authenticated but locked: only /lock is reachable.
// - Authenticated + unlocked: full app shell.
function ProtectedShell(): React.ReactElement {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const locked = useAppLockStore((s) => s.locked);
  const location = useLocation();

  if (!isAuth) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (locked) {
    return <Navigate to="/lock" replace />;
  }
  return <AppShell />;
}

function LoginGuard(): React.ReactElement {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  if (isAuth) return <Navigate to="/" replace />;
  return <LoginScreen />;
}

function LockGuard(): React.ReactElement {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  if (!isAuth) return <Navigate to="/login" replace />;
  return <AppLockScreen />;
}

export function Routes(): React.ReactElement {
  return (
    <RRRoutes>
      <Route path="/login" element={<LoginGuard />} />
      <Route path="/lock" element={<LockGuard />} />
      <Route element={<ProtectedShell />}>
        <Route path="/" element={<DashboardScreen />} />
        <Route path="/transactions" element={<TransactionListScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </RRRoutes>
  );
}
