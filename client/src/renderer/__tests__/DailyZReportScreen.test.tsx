/** @jest-environment jsdom */
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { DailyZReportScreen } from '../screens/DailyZReportScreen';

const relayCallMock = jest.fn();
const printZReportMock = jest.fn();

beforeEach(() => {
  relayCallMock.mockReset();
  printZReportMock.mockReset();
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
      settings: {
        get: jest.fn(),
        set: jest.fn(),
        onChanged: jest.fn().mockReturnValue(() => undefined),
      },
      lock: {
        getState: jest.fn(),
        setPin: jest.fn(),
        verifyPin: jest.fn(),
        clearPin: jest.fn(),
        lockNow: jest.fn(),
        onStateChanged: jest.fn().mockReturnValue(() => undefined),
      },
      diagnostics: { getRecentLogs: jest.fn() },
      print: {
        receipt: jest.fn(),
        testPage: jest.fn(),
        zReport: printZReportMock,
      },
    },
  });
});

// payment_method_breakdown values are CENTS (money). sales_by_staff and
// hourly_breakdown are sale COUNTS (integers). Per the type definition in
// shared/src/types/api.types.ts and the printService rendering.
const SAMPLE_REPORT = {
  date: '2026-05-08',
  user_id: null,
  total_sales: 12,
  completed_sales: 11,
  pending_sales: 1,
  total_revenue_cents: 123400,
  total_gst_cents: 11218,
  total_discount_cents: 0,
  unique_customers: 9,
  total_items_sold: 28,
  average_sale_cents: 10283,
  payment_method_breakdown: { cash: 70000, card: 53400 },
  sales_by_staff: { 'Pat Cashier': 8, 'Sam Manager': 4 },
  hourly_breakdown: { '9': 2, '10': 3, '11': 5, '12': 2 },
  sales_by_status: { completed: 11, pending: 1 },
};

describe('DailyZReportScreen', () => {
  test('renders the stat strip + payment + staff sections from a successful relay response', async () => {
    relayCallMock.mockResolvedValue({ ok: true, data: SAMPLE_REPORT });

    render(
      <MemoryRouter>
        <DailyZReportScreen />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getAllByText('Sales').length).toBeGreaterThan(0));

    // Revenue stat — use a flexible matcher; Intl currency formatting may
    // emit either $1,234.00 or A$1,234.00 depending on locale.
    expect(screen.getAllByText(/1,234\.00/).length).toBeGreaterThan(0);
    // Items sold count.
    expect(screen.getByText('28')).toBeInTheDocument();
    // Payment method rows render money (CENTS converted to dollars).
    expect(screen.getByText('cash')).toBeInTheDocument();
    expect(screen.getByText('card')).toBeInTheDocument();
    // The cash row shows $700.00 (70000 cents), not the raw "70000" or "7".
    const cashRow = screen.getByText('cash').closest('tr');
    expect(cashRow).toBeTruthy();
    expect(cashRow!.textContent).toMatch(/700\.00/);
    expect(cashRow!.textContent).not.toMatch(/\b70000\b/);
    // The breakdown column header reads "Total" (money), not "Sales" (count).
    const breakdownTable = cashRow!.closest('table');
    expect(breakdownTable).toBeTruthy();
    expect(breakdownTable!.querySelector('thead')!.textContent).toMatch(/Total/);
    // Sales-by-staff entries render counts.
    expect(screen.getByText('Pat Cashier')).toBeInTheDocument();
    expect(screen.getByText('Sam Manager')).toBeInTheDocument();
    const patRow = screen.getByText('Pat Cashier').closest('tr');
    expect(patRow!.textContent).toMatch(/8/);
    expect(patRow!.textContent).not.toMatch(/\$/);
  });

  test('Print Z-report invokes window.aeris.print.zReport with the selected date and surfaces success', async () => {
    relayCallMock.mockResolvedValue({ ok: true, data: SAMPLE_REPORT });
    printZReportMock.mockResolvedValue({ ok: true });

    render(
      <MemoryRouter>
        <DailyZReportScreen />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Print Z-report/i })).not.toBeDisabled(),
    );

    fireEvent.click(screen.getByRole('button', { name: /Print Z-report/i }));

    await waitFor(() => expect(printZReportMock).toHaveBeenCalledTimes(1));
    expect(typeof printZReportMock.mock.calls[0][0]).toBe('string');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/sent to the printer/i),
    );
  });

  test('renders empty-state when the day has no sales', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: {
        ...SAMPLE_REPORT,
        total_sales: 0,
        total_revenue_cents: 0,
        total_items_sold: 0,
        payment_method_breakdown: {},
        sales_by_staff: {},
        hourly_breakdown: {},
        sales_by_status: {},
      },
    });

    render(
      <MemoryRouter>
        <DailyZReportScreen />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByText(/No sales for this day/i)).toBeInTheDocument(),
    );
  });

  test('payment_method_breakdown renders as a money string (cents → dollars)', async () => {
    // Distinct fixture: pick cents that won't collide with any other money
    // values on the screen, so a single regex unambiguously asserts the row.
    relayCallMock.mockResolvedValue({
      ok: true,
      data: {
        ...SAMPLE_REPORT,
        payment_method_breakdown: { cash: 24700 }, // $247.00
      },
    });

    render(
      <MemoryRouter>
        <DailyZReportScreen />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('cash')).toBeInTheDocument());
    const row = screen.getByText('cash').closest('tr');
    expect(row).toBeTruthy();
    // Reads as money (e.g. "$247.00" / "A$247.00"), not the raw "24700".
    expect(row!.textContent).toMatch(/247\.00/);
    expect(row!.textContent).not.toMatch(/\b24700\b/);
  });
});
