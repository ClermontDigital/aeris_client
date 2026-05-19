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

// Mock ApiClient — the screen reads getDailySummary and getTransactions
// (the latter feeds the recent-customers widget). Both are stubbed; the
// transactions stub defaults to an empty page so tests that don't care
// don't have to set it explicitly.
const mockGetDailySummary = jest.fn();
const mockGetTransactions = jest.fn().mockResolvedValue({
  data: [],
  meta: {current_page: 1, last_page: 1, per_page: 50, total: 0},
});
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    getDailySummary: (...args: unknown[]) => mockGetDailySummary(...args),
    getTransactions: (...args: unknown[]) => mockGetTransactions(...args),
  },
}));

// Auth store — the dashboard greets a first name. Stub the selector hook so
// we don't pull zustand into RTL's renderer (the real shim hits a use-sync-
// external-store mismatch under jest-expo).
jest.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (s: {user: {name: string}}) => unknown) =>
    selector({user: {name: 'Alex Tester'}}),
}));

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
// because the dashboard's useFocusEffect schedules a setState.)
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: jest.fn()}),
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
    expect(getByText('Items Sold')).toBeTruthy();
    expect(getByText('Avg Sale')).toBeTruthy();
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
});
