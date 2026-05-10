import React from 'react';
import { Navigate, Route, Routes as RRRoutes, useLocation } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { LoginScreen } from '../screens/LoginScreen';
import { AppLockScreen } from '../screens/AppLockScreen';
import { PinSetupScreen } from '../screens/PinSetupScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { ItemsScreen } from '../screens/ItemsScreen';
import { ProductDetailScreen } from '../screens/ProductDetailScreen';
import { CustomersScreen } from '../screens/CustomersScreen';
import { CustomerDetailScreen } from '../screens/CustomerDetailScreen';
import { CustomerEditScreen } from '../screens/CustomerEditScreen';
import { ItemEditScreen } from '../screens/ItemEditScreen';
import { DailyZReportScreen } from '../screens/DailyZReportScreen';
import { TransactionListScreen } from '../screens/TransactionListScreen';
import { SaleDetailScreen } from '../screens/SaleDetailScreen';
import { ReceiptViewerScreen } from '../screens/ReceiptViewerScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { QuickSaleScreen } from '../screens/QuickSaleScreen';
import { CartScreen } from '../screens/CartScreen';
import { CheckoutScreen } from '../screens/CheckoutScreen';
import { useAuthStore } from '../stores/authStore';
import { useAppLockStore } from '../stores/appLockStore';

// Auth + lock guard.
// - Not authenticated: only /login is reachable.
// - Authenticated but no PIN: PinSetupScreen takes over the whole app.
// - Authenticated + PIN set + locked: only /lock is reachable.
// - Authenticated + unlocked: full app shell.
function ProtectedShell(): React.ReactElement {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  // Individual primitive selectors so attempts/lockedOutUntilMs churn doesn't
  // re-render the whole shell + every nested screen.
  const isPinSet = useAppLockStore((s) => s.isPinSet);
  const locked = useAppLockStore((s) => s.locked);
  const location = useLocation();

  if (!isAuth) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (!isPinSet) {
    return <PinSetupScreen />;
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
  const isPinSet = useAppLockStore((s) => s.isPinSet);
  const locked = useAppLockStore((s) => s.locked);
  if (!isAuth) return <Navigate to="/login" replace />;
  if (!isPinSet) return <Navigate to="/" replace />;
  if (!locked) return <Navigate to="/" replace />;
  return <AppLockScreen />;
}

export function Routes(): React.ReactElement {
  return (
    <RRRoutes>
      <Route path="/login" element={<LoginGuard />} />
      <Route path="/lock" element={<LockGuard />} />
      <Route element={<ProtectedShell />}>
        <Route path="/" element={<DashboardScreen />} />
        <Route path="/dashboard/eod" element={<DailyZReportScreen />} />
        <Route path="/pos" element={<QuickSaleScreen />} />
        <Route path="/pos/cart" element={<CartScreen />} />
        <Route path="/pos/checkout" element={<CheckoutScreen />} />
        <Route path="/items" element={<ItemsScreen />} />
        <Route path="/items/new" element={<ItemEditScreen />} />
        <Route path="/items/:id" element={<ProductDetailScreen />} />
        <Route path="/items/:id/edit" element={<ItemEditScreen />} />
        <Route path="/customers" element={<CustomersScreen />} />
        <Route path="/customers/new" element={<CustomerEditScreen />} />
        <Route path="/customers/:id" element={<CustomerDetailScreen />} />
        <Route path="/customers/:id/edit" element={<CustomerEditScreen />} />
        <Route path="/transactions" element={<TransactionListScreen />} />
        <Route path="/transactions/:id" element={<SaleDetailScreen />} />
        <Route path="/transactions/:id/receipt" element={<ReceiptViewerScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </RRRoutes>
  );
}
