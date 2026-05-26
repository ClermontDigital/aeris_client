import React from 'react';
import {render, waitFor, fireEvent} from '@testing-library/react-native';
import type {Sale} from '../../types/api.types';

// React 19's reportGlobalError uses window.dispatchEvent to surface caught
// errors. jest-expo's environment doesn't provide that, so without this stub
// any error inside an effect bubbles up as a confusing
// "TypeError: window.dispatchEvent is not a function" instead of the real
// stack trace. Mirrors the DashboardScreen test setup.
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

const mockGetTransactions = jest.fn();
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    getTransactions: (...args: unknown[]) => mockGetTransactions(...args),
  },
}));

// Stable haptics ref — returning a fresh object would reset useCallback
// dep arrays in the screen and trigger an effect→fetch loop.
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

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: jest.fn()}),
  // TransactionListScreen reads `route.params?.productId` to seed an
  // optional product filter; default to an empty params bag here so
  // the unfiltered baseline still renders.
  useRoute: () => ({params: {}}),
}));

import TransactionListScreen from '../TransactionListScreen';

const sample: Sale = {
  id: 1,
  sale_number: 'SALE-0001',
  status: 'completed',
  total_cents: 12345,
  customer_name: 'Test Customer',
  created_at: new Date().toISOString(),
} as Sale;

const baseResponse = {
  data: [sample],
  meta: {current_page: 1, last_page: 1, per_page: 20, total: 1},
};

describe('TransactionListScreen', () => {
  beforeEach(() => {
    mockGetTransactions.mockReset();
  });

  it('renders the active filter pill with crimson background', async () => {
    mockGetTransactions.mockResolvedValue(baseResponse);

    const {getByLabelText} = render(<TransactionListScreen />);

    await waitFor(() => {
      expect(mockGetTransactions).toHaveBeenCalled();
    });

    // 'all' is the default — the pill should be styled active so users
    // open the screen onto populated data rather than an empty Today list.
    const allPill = getByLabelText('Filter All');
    const flatStyle = Array.isArray(allPill.props.style)
      ? Object.assign({}, ...allPill.props.style.flat())
      : allPill.props.style;
    expect(flatStyle.backgroundColor).toBe('#c1121f'); // COLORS.crimson
    expect(flatStyle.borderColor).toBe('#c1121f');
    expect(allPill.props.accessibilityState).toMatchObject({selected: true});

    const todayPill = getByLabelText('Filter Today');
    expect(todayPill.props.accessibilityState).toMatchObject({selected: false});
  });

  it('renders list rows with accessibilityRole="button" and a contextual label', async () => {
    mockGetTransactions.mockResolvedValue(baseResponse);

    const {findByLabelText} = render(<TransactionListScreen />);

    const row = await findByLabelText(/Sale SALE-0001/);
    expect(row.props.accessibilityRole).toBe('button');
    expect(typeof row.props.accessibilityLabel).toBe('string');
    expect(row.props.accessibilityLabel.length).toBeGreaterThan(0);
    expect(row.props.accessibilityLabel).toContain('$123.45');
  });

  it('shows the shared ErrorBanner with a retry affordance on relay failure', async () => {
    mockGetTransactions.mockRejectedValue(new Error('Relay unreachable'));

    const {getByText, getByLabelText} = render(<TransactionListScreen />);

    await waitFor(() => {
      expect(getByText('Relay unreachable')).toBeTruthy();
    });
    // The shared ErrorBanner exposes Retry by accessibilityLabel.
    expect(getByLabelText('Retry')).toBeTruthy();

    mockGetTransactions.mockResolvedValue(baseResponse);
    fireEvent.press(getByLabelText('Retry'));

    await waitFor(() => {
      expect(mockGetTransactions).toHaveBeenCalledTimes(2);
    });
  });
});
