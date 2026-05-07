/** @jest-environment jsdom */
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ReceiptViewerScreen } from '../screens/ReceiptViewerScreen';

const relayCallMock = jest.fn();

const SAMPLE_RECEIPT = {
  sale_number: 'INV-1',
  business_name: 'Acme Corp',
  business_address: '1 Main Street',
  items: [
    { name: 'Widget', quantity: 2, unit_price: '$5.00', line_total: '$10.00' },
  ],
  subtotal: '$10.00',
  tax: '$1.00',
  total: '$11.00',
  payments: [{ method: 'card', amount: '$11.00' }],
  date: '2026-05-07',
  served_by: 'Alice',
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
    <MemoryRouter initialEntries={[`/transactions/${saleId}/receipt`]}>
      <Routes>
        <Route path="/transactions/:id/receipt" element={<ReceiptViewerScreen />} />
        <Route path="/transactions/:id" element={<div>SaleDetail sentinel</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ReceiptViewerScreen', () => {
  test('renders business header, items, totals, and served-by line', async () => {
    relayCallMock.mockResolvedValue({ ok: true, data: SAMPLE_RECEIPT });
    renderAt();
    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
    expect(screen.getByText('1 Main Street')).toBeInTheDocument();
    expect(screen.getByText('Sale #INV-1')).toBeInTheDocument();
    expect(screen.getByText('Widget')).toBeInTheDocument();
    // $11.00 appears in both Total and Payments sections.
    expect(screen.getAllByText('$11.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Served by Alice/)).toBeInTheDocument();
  });

  test('shows "printing coming in a later release" subtitle', async () => {
    relayCallMock.mockResolvedValue({ ok: true, data: SAMPLE_RECEIPT });
    renderAt();
    await waitFor(() =>
      expect(screen.getByText(/printing coming in a later release/i)).toBeInTheDocument(),
    );
  });

  test('Back button navigates to sale detail', async () => {
    relayCallMock.mockResolvedValue({ ok: true, data: SAMPLE_RECEIPT });
    renderAt();
    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Back/i }));
    expect(screen.getByText('SaleDetail sentinel')).toBeInTheDocument();
  });

  test('error banner renders on relay failure', async () => {
    relayCallMock.mockResolvedValue({ ok: false, code: 'SERVER', message: 'broken' });
    renderAt();
    await waitFor(() => expect(screen.getByText('broken')).toBeInTheDocument());
  });
});
