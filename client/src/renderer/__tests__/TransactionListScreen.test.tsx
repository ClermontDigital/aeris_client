/** @jest-environment jsdom */
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { TransactionListScreen } from '../screens/TransactionListScreen';

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

function renderAt(path = '/transactions') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/transactions" element={<TransactionListScreen />} />
        <Route path="/transactions/:id" element={<div>SaleDetail {/* sentinel */}</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('TransactionListScreen', () => {
  test('renders empty state when there are no sales', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: { data: [], meta: { current_page: 1, last_page: 1, per_page: 20, total: 0 } },
    });
    renderAt();
    await waitFor(() => expect(screen.getByText(/No transactions in this date range/i)).toBeInTheDocument());
  });

  test('renders rows and a clickable row navigates to /transactions/:id', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: {
        data: [
          {
            id: 42,
            sale_number: 'INV-42',
            total_cents: 9999,
            tax_cents: 909,
            subtotal_cents: 9090,
            discount_cents: 0,
            status: 'completed',
            items_count: 2,
            customer_name: 'Acme',
            created_at: '2026-05-07T08:00:00Z',
          },
        ],
        meta: { current_page: 1, last_page: 1, per_page: 20, total: 1 },
      },
    });
    renderAt();
    await waitFor(() => expect(screen.getByText('INV-42')).toBeInTheDocument());
    fireEvent.click(screen.getByText('INV-42'));
    await waitFor(() => expect(screen.getByText(/SaleDetail/)).toBeInTheDocument());
  });

  test('Walk-in label shows when customer_name is null', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: {
        data: [
          {
            id: 1,
            sale_number: 'INV-1',
            total_cents: 0,
            tax_cents: 0,
            subtotal_cents: 0,
            discount_cents: 0,
            status: 'completed',
            items_count: 0,
            customer_name: null,
            created_at: '2026-05-07T08:00:00Z',
          },
        ],
        meta: { current_page: 1, last_page: 1, per_page: 20, total: 1 },
      },
    });
    renderAt();
    await waitFor(() => expect(screen.getByText('Walk-in')).toBeInTheDocument());
  });

  test('pagination buttons call relay with the next page', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: {
        data: [
          {
            id: 1,
            sale_number: 'INV-1',
            total_cents: 0,
            tax_cents: 0,
            subtotal_cents: 0,
            discount_cents: 0,
            status: 'completed',
            items_count: 0,
            customer_name: 'X',
            created_at: '2026-05-07T08:00:00Z',
          },
        ],
        meta: { current_page: 1, last_page: 3, per_page: 20, total: 60 },
      },
    });
    renderAt();
    await waitFor(() => expect(screen.getByText('INV-1')).toBeInTheDocument());
    expect(relayCallMock).toHaveBeenCalledWith('transactions.list', { page: 1, per_page: 20 }, undefined);
    fireEvent.click(screen.getByRole('button', { name: /Next/i }));
    await waitFor(() =>
      expect(relayCallMock).toHaveBeenCalledWith('transactions.list', { page: 2, per_page: 20 }, undefined),
    );
  });
});
