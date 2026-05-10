/** @jest-environment jsdom */
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CustomerDetailScreen } from '../screens/CustomerDetailScreen';

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

function renderAt(path = '/customers/42') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/customers" element={<div>List sentinel</div>} />
        <Route path="/customers/:id" element={<CustomerDetailScreen />} />
        <Route path="/transactions/:id" element={<div>Sale sentinel</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const SAMPLE_CUSTOMER = {
  id: 42,
  name: 'Jane Smith',
  first_name: 'Jane',
  last_name: 'Smith',
  company: 'Acme Co.',
  email: 'jane@example.com',
  phone: '+61 400 000 000',
  mobile: null,
  customer_number: 'C-42',
  account_balance_cents: 0,
  payment_terms: null,
  credit_limit_cents: null,
  loyalty_points: 50,
  total_orders: 3,
  total_spent_cents: 12500,
  last_purchase_date: '2026-04-01T08:00:00Z',
  recent_sales: [
    {
      id: 7,
      sale_number: 'INV-7',
      total_cents: 4500,
      tax_cents: 409,
      subtotal_cents: 4091,
      discount_cents: 0,
      status: 'completed',
      items_count: 1,
      customer_name: 'Jane Smith',
      created_at: '2026-04-01T08:00:00Z',
    },
  ],
  addresses: [
    {
      id: 1,
      label: 'Home',
      line_1: '1 High St',
      line_2: null,
      city: 'Brisbane',
      state: 'QLD',
      postcode: '4000',
      country: 'Australia',
    },
  ],
  default_address: null,
  notes: 'VIP',
  created_at: '2025-01-01T00:00:00Z',
};

describe('CustomerDetailScreen', () => {
  test('renders contact info and recent sales', async () => {
    relayCallMock.mockResolvedValue({ ok: true, data: SAMPLE_CUSTOMER });
    renderAt();
    await waitFor(() => expect(screen.getByRole('heading', { name: /Jane Smith/ })).toBeInTheDocument());
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(screen.getByText('+61 400 000 000')).toBeInTheDocument();
    expect(screen.getByText('Acme Co.')).toBeInTheDocument();
    expect(screen.getByText('1 High St')).toBeInTheDocument();
    expect(screen.getByText(/Brisbane.*QLD.*4000/)).toBeInTheDocument();
    expect(screen.getByText('INV-7')).toBeInTheDocument();
    expect(screen.getByText('VIP')).toBeInTheDocument();
  });

  test('renders not-found state when relay returns null', async () => {
    relayCallMock.mockResolvedValue({ ok: true, data: null });
    renderAt();
    await waitFor(() => expect(screen.getByText(/Customer not found/i)).toBeInTheDocument());
  });

  test('clicking a recent sale row navigates to /transactions/:id', async () => {
    relayCallMock.mockResolvedValue({ ok: true, data: SAMPLE_CUSTOMER });
    renderAt();
    await waitFor(() => expect(screen.getByText('INV-7')).toBeInTheDocument());
    fireEvent.click(screen.getByText('INV-7'));
    await waitFor(() => expect(screen.getByText(/Sale sentinel/)).toBeInTheDocument());
  });
});
