/** @jest-environment jsdom */
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SaleDetailScreen } from '../screens/SaleDetailScreen';

const relayCallMock = jest.fn();

const SAMPLE_SALE = {
  id: 1,
  sale_number: 'INV-1',
  total_cents: 11000,
  tax_cents: 1000,
  subtotal_cents: 10000,
  discount_cents: 0,
  status: 'completed' as const,
  items_count: 1,
  customer_name: 'Acme',
  created_at: '2026-05-07T08:00:00Z',
  items: [
    {
      product_id: 7,
      product_name: 'Widget',
      sku: 'W-7',
      quantity: 2,
      unit_price_cents: 5000,
      line_total_cents: 10000,
      discount_cents: 0,
    },
  ],
  payments: [{ method: 'card', amount_cents: 11000, reference: null }],
  customer: null,
};

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

function renderAt(saleId = 1) {
  return render(
    <MemoryRouter initialEntries={[`/transactions/${saleId}`]}>
      <Routes>
        <Route path="/transactions/:id" element={<SaleDetailScreen />} />
        <Route path="/transactions" element={<div>List sentinel</div>} />
        <Route path="/transactions/:id/receipt" element={<div>Receipt sentinel</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SaleDetailScreen', () => {
  test('renders the sale header, items, totals', async () => {
    relayCallMock.mockResolvedValue({ ok: true, data: SAMPLE_SALE });
    renderAt();
    await waitFor(() => expect(screen.getByRole('heading', { name: /Sale INV-1/ })).toBeInTheDocument());
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    // "Total" appears in both the items table header and the totals
    // section — getAllByText returns at least one of each.
    expect(screen.getAllByText('Total').length).toBeGreaterThanOrEqual(1);
  });

  test('Back button navigates to /transactions', async () => {
    relayCallMock.mockResolvedValue({ ok: true, data: SAMPLE_SALE });
    renderAt();
    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Back/i }));
    expect(screen.getByText('List sentinel')).toBeInTheDocument();
  });

  test('View Receipt button navigates to receipt route', async () => {
    relayCallMock.mockResolvedValue({ ok: true, data: SAMPLE_SALE });
    renderAt();
    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /View Receipt/i }));
    expect(screen.getByText('Receipt sentinel')).toBeInTheDocument();
  });

  test('renders walk-in label when no customer is attached', async () => {
    relayCallMock.mockResolvedValue({ ok: true, data: { ...SAMPLE_SALE, customer: null } });
    renderAt();
    await waitFor(() => expect(screen.getByText(/Walk-in customer/i)).toBeInTheDocument());
  });

  test('renders ErrorBanner on relay failure', async () => {
    relayCallMock.mockResolvedValue({ ok: false, code: 'SERVER', message: 'gateway' });
    renderAt();
    await waitFor(() => expect(screen.getByText(/gateway/i)).toBeInTheDocument());
  });
});
