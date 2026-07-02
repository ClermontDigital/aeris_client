import React from 'react';
import {render, waitFor, fireEvent} from '@testing-library/react-native';
import type {DailySummary} from '../../types/api.types';

// React 19's reportGlobalError uses window.dispatchEvent to surface caught
// errors. jest-expo's environment doesn't provide that, so without this stub
// any error inside an effect bubbles up as a confusing
// "TypeError: window.dispatchEvent is not a function" instead of the real
// stack trace.
beforeAll(() => {
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = {};
  }
  if (typeof (globalThis as any).window.dispatchEvent !== 'function') {
    (globalThis as any).window.dispatchEvent = () => true;
    (globalThis as any).window.addEventListener = () => undefined;
    (globalThis as any).window.removeEventListener = () => undefined;
    (globalThis as any).window.ErrorEvent = class {};
  }
});

// Mock ApiClient — the screen reads getDailySummary, getTransactions and
// listRepairs. All three are stubbed; the transactions stub defaults to
// an empty page and listRepairs defaults to zero-total so tests that
// don't care don't have to set it explicitly.
const mockGetDailySummary = jest.fn();
const mockGetTransactions = jest.fn().mockResolvedValue({
  data: [],
  meta: {current_page: 1, last_page: 1, per_page: 50, total: 0},
});
const mockListRepairs = jest.fn().mockResolvedValue({
  data: [],
  meta: {current_page: 1, last_page: 1, per_page: 1, total: 0},
});
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    getDailySummary: (...args: unknown[]) => mockGetDailySummary(...args),
    getTransactions: (...args: unknown[]) => mockGetTransactions(...args),
    listRepairs: (...args: unknown[]) => mockListRepairs(...args),
  },
}));

// Workspace features store — the Repairs card gates on `repairs_enabled`.
// Tests mutate this via `setRepairsEnabled` before calling render(). The
// mock exposes a hook selector so the Dashboard's useWorkspaceFeaturesStore
// call renders synchronously.
let mockRepairsEnabled = false;
const setRepairsEnabled = (v: boolean) => {
  mockRepairsEnabled = v;
};
jest.mock('../../stores/workspaceFeaturesStore', () => ({
  useWorkspaceFeaturesStore: (
    selector: (s: {repairs_enabled: boolean}) => unknown,
  ) => selector({repairs_enabled: mockRepairsEnabled}),
}));

// Auth store — the dashboard greets a first name. Stub the selector hook so
// we don't pull zustand into RTL's renderer (the real shim hits a use-sync-
// external-store mismatch under jest-expo).
jest.mock('../../stores/authStore', () => {
  // Minimal shape: most callers use the selector form, ErrorBanner reads
  // via `getState()` AND now also calls `subscribe()` (since the v1.3.25
  // re-render-on-auth-change fix). The mock has to expose all three call
  // styles. `isAuthenticated: true` keeps the suppression off in this test —
  // the relay-error path under test is a network failure, not an auth
  // expiry. `subscribe` returns a no-op unsubscribe; the store state never
  // changes during the test so the listener never fires.
  const state = {
    user: {name: 'Alex Tester'},
    isAuthenticated: true,
    errorKind: null,
  };
  const useAuthStore = (selector: (s: typeof state) => unknown) =>
    selector(state);
  (useAuthStore as unknown as {getState: () => typeof state}).getState = () =>
    state;
  (useAuthStore as unknown as {subscribe: (l: () => void) => () => void}).subscribe =
    () => () => undefined;
  return {useAuthStore};
});

// Settings store — dashboard reads dashboardSecondaryWidget. Default to
// 'top_products' to preserve the prior test behaviour.
jest.mock('../../stores/settingsStore', () => ({
  useSettingsStore: (
    selector: (s: {settings: {dashboardSecondaryWidget: string}}) => unknown,
  ) => selector({settings: {dashboardSecondaryWidget: 'top_products'}}),
}));

// Haptics: stable no-op reference. Returning a fresh object each call would
// reset useCallback deps that depend on `haptics`, causing render loops.
jest.mock('../../hooks/useHaptics', () => {
  const stable = {
    light: jest.fn(),
    medium: jest.fn(),
    selection: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
  };
  return {useHaptics: () => stable};
});

// Navigation: in tests we don't simulate focus transitions — useFocusEffect
// becomes a no-op. (Calling cb() each render hits "too many re-renders"
// because the dashboard's useFocusEffect schedules a setState.) `navigate`
// is a stable module-level jest.fn so tests can assert on it.
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: mockNavigate}),
  useFocusEffect: () => undefined,
}));

import DashboardScreen from '../DashboardScreen';

const baseSummary: DailySummary = {
  date: '2026-05-08',
  sales_count: 3,
  revenue_cents: 12345,
  items_sold: 5,
  average_sale_cents: 4115,
  top_products: [
    {id: 1, name: 'Widget A', quantity: 4, revenue_cents: 8000},
    {id: 2, name: 'Widget B', quantity: 1, revenue_cents: 4345},
  ],
};

describe('DashboardScreen', () => {
  beforeEach(() => {
    mockGetDailySummary.mockReset();
    mockNavigate.mockReset();
    mockListRepairs.mockReset();
    // Default to zero total unless a test overrides.
    mockListRepairs.mockResolvedValue({
      data: [],
      meta: {current_page: 1, last_page: 1, per_page: 1, total: 0},
    });
    setRepairsEnabled(false);
  });

  it('renders the stat strip with values from the daily summary', async () => {
    mockGetDailySummary.mockResolvedValue(baseSummary);

    const {getByText, getAllByText} = render(<DashboardScreen />);

    await waitFor(() => {
      // Multiple "Sales" strings can appear (StatCard label + hero footnote
       // copy "N sales so far"); the stat-strip label is the uppercase one.
       expect(getAllByText('Sales').length).toBeGreaterThan(0);
    });

    expect(getByText('3')).toBeTruthy(); // sales_count
    expect(getByText('5')).toBeTruthy(); // items_sold
    expect(getByText('Items sold')).toBeTruthy();
    expect(getByText('Avg sale')).toBeTruthy();
  });

  it('surfaces a relay error via ErrorBanner with a retry affordance', async () => {
    mockGetDailySummary.mockRejectedValue(new Error('Relay unreachable'));

    const {getByText, getByLabelText, getAllByText} = render(<DashboardScreen />);

    await waitFor(() => {
      expect(getByText('Relay unreachable')).toBeTruthy();
    });

    // ErrorBanner exposes a Retry button via accessibilityLabel.
    mockGetDailySummary.mockResolvedValue(baseSummary);
    fireEvent.press(getByLabelText('Retry'));

    await waitFor(() => {
      // Multiple "Sales" strings can appear (StatCard label + hero footnote
       // copy "N sales so far"); the stat-strip label is the uppercase one.
       expect(getAllByText('Sales').length).toBeGreaterThan(0);
    });
  });

  describe('Repairs card', () => {
    it('is hidden when the workspace flag is off', async () => {
      setRepairsEnabled(false);
      mockGetDailySummary.mockResolvedValue(baseSummary);

      const {queryByText} = render(<DashboardScreen />);

      await waitFor(() => {
        expect(queryByText('Items sold')).toBeTruthy();
      });
      // Eyebrow label 'Repairs' should NOT render.
      expect(queryByText('Repairs')).toBeNull();
      // And listRepairs must not have been called.
      expect(mockListRepairs).not.toHaveBeenCalled();
    });

    it('renders ready count + in-progress footnote when flag is on', async () => {
      setRepairsEnabled(true);
      mockGetDailySummary.mockResolvedValue(baseSummary);
      mockListRepairs
        .mockResolvedValueOnce({
          data: [],
          meta: {current_page: 1, last_page: 1, per_page: 1, total: 7},
        })
        .mockResolvedValueOnce({
          data: [],
          meta: {current_page: 1, last_page: 1, per_page: 1, total: 4},
        });

      const {getByText, getAllByText} = render(<DashboardScreen />);

      await waitFor(() => {
        expect(getAllByText('Repairs').length).toBeGreaterThan(0);
      });
      await waitFor(() => {
        expect(getByText('7')).toBeTruthy(); // ready count
      });
      expect(getByText('ready for pickup')).toBeTruthy();
      expect(getByText('4 in progress')).toBeTruthy();
      // Both filters requested.
      expect(mockListRepairs).toHaveBeenCalledWith(1, 1, {status: 'ready'});
      expect(mockListRepairs).toHaveBeenCalledWith(1, 1, {
        status: 'in_progress',
      });
    });

    it('renders a fallback when the repairs fetch errors', async () => {
      setRepairsEnabled(true);
      mockGetDailySummary.mockResolvedValue(baseSummary);
      mockListRepairs.mockRejectedValue(new Error('boom'));

      const {getByText, getAllByText} = render(<DashboardScreen />);

      await waitFor(() => {
        expect(getAllByText('Repairs').length).toBeGreaterThan(0);
      });
      await waitFor(() => {
        expect(getByText('Currently unavailable')).toBeTruthy();
      });
      // Value placeholder is '-' — no numeric value rendered.
      expect(getByText('-')).toBeTruthy();
    });

    it('tap navigates into the Repairs stack RepairsList', async () => {
      setRepairsEnabled(true);
      mockGetDailySummary.mockResolvedValue(baseSummary);
      mockListRepairs.mockResolvedValue({
        data: [],
        meta: {current_page: 1, last_page: 1, per_page: 1, total: 2},
      });

      const {getByLabelText, getAllByText} = render(<DashboardScreen />);

      await waitFor(() => {
        expect(getAllByText('Repairs').length).toBeGreaterThan(0);
      });
      // The accessibilityLabel starts with "2 repairs ready for pickup".
      const tapTarget = getByLabelText(
        /repairs ready for pickup, tap to open the repairs list/,
      );
      fireEvent.press(tapTarget);

      expect(mockNavigate).toHaveBeenCalledWith('Repairs', {
        screen: 'RepairsList',
      });
    });
  });
});
