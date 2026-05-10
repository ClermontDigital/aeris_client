/** @jest-environment jsdom */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { DashboardScreen } from '../screens/DashboardScreen';

const relayCallMock = jest.fn();

beforeEach(() => {
  relayCallMock.mockReset();
  Object.defineProperty(window, 'aeris', {
    configurable: true,
    value: {
      app: { version: jest.fn() },
      relay: { call: relayCallMock },
      auth: {
        getState: jest.fn(),
        login: jest.fn(),
        logout: jest.fn(),
        onStateChanged: jest.fn().mockReturnValue(() => undefined),
      },
      settings: { get: jest.fn(), set: jest.fn(), onChanged: jest.fn().mockReturnValue(() => undefined) },
      lock: {
        getState: jest.fn(),
        setPin: jest.fn(),
        verifyPin: jest.fn(),
        clearPin: jest.fn(),
        lockNow: jest.fn(),
        onStateChanged: jest.fn().mockReturnValue(() => undefined),
      },
      diagnostics: { getRecentLogs: jest.fn() },
    },
  });
});

describe('DashboardScreen', () => {
  test('renders revenue + sales count when data is populated', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: {
        date: '2026-05-07',
        revenue_cents: 12500,
        sales_count: 7,
        items_sold: 21,
        average_sale_cents: 1786,
        top_products: [],
      },
    });
    render(<DashboardScreen />);
    await waitFor(() => expect(screen.getByText(/Revenue/i)).toBeInTheDocument());
    // Locale-flexible currency check — locale + currency formatting can
    // render "A$125.00" or "$125.00" depending on the test machine.
    expect(screen.getByText(/125\.00/)).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  test('renders empty state when summary is all zeros', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: {
        date: '2026-05-07',
        revenue_cents: 0,
        sales_count: 0,
        items_sold: 0,
        average_sale_cents: 0,
        top_products: [],
      },
    });
    render(<DashboardScreen />);
    await waitFor(() => expect(screen.getByText(/You're all set/i)).toBeInTheDocument());
    expect(screen.getByText(/No sales recorded yet today/i)).toBeInTheDocument();
  });

  test('shows last refreshed timestamp after a successful load', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: {
        date: '2026-05-07',
        revenue_cents: 0,
        sales_count: 0,
        items_sold: 0,
        average_sale_cents: 0,
        top_products: [],
      },
    });
    render(<DashboardScreen />);
    await waitFor(() => expect(screen.getByText(/Last refreshed/i)).toBeInTheDocument());
  });

  test('loading state advertises "Loading dashboard"', async () => {
    let resolve!: (v: unknown) => void;
    relayCallMock.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<DashboardScreen />);
    expect(screen.getByText(/Loading dashboard/i)).toBeInTheDocument();
    resolve({
      ok: true,
      data: {
        date: '2026-05-07',
        revenue_cents: 0,
        sales_count: 0,
        items_sold: 0,
        average_sale_cents: 0,
        top_products: [],
      },
    });
    await waitFor(() => expect(screen.queryByText(/Loading dashboard/i)).not.toBeInTheDocument());
  });

  test('renders error banner on relay failure', async () => {
    relayCallMock.mockResolvedValue({
      ok: false,
      code: 'NETWORK',
      message: 'connection refused',
    });
    render(<DashboardScreen />);
    await waitFor(() => expect(screen.getByText(/connection refused/i)).toBeInTheDocument());
  });

  test('refresh button re-invokes the relay', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: {
        date: '2026-05-07',
        revenue_cents: 10000,
        sales_count: 1,
        items_sold: 1,
        average_sale_cents: 10000,
        top_products: [],
      },
    });
    render(<DashboardScreen />);
    // Wait for the first fetch to settle so the Refresh button is enabled.
    await waitFor(() => expect(screen.getByRole('button', { name: /Refresh/i })).not.toBeDisabled());
    expect(relayCallMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    await waitFor(() => expect(relayCallMock).toHaveBeenCalledTimes(2));
  });
});
