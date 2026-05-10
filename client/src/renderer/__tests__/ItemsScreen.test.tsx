/** @jest-environment jsdom */
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ItemsScreen } from '../screens/ItemsScreen';

const relayCallMock = jest.fn();

beforeEach(() => {
  relayCallMock.mockReset();
  jest.useFakeTimers();
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

afterEach(() => {
  jest.useRealTimers();
});

function renderAt(path = '/items') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/items" element={<ItemsScreen />} />
        <Route path="/items/:id" element={<div>ProductDetail sentinel</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const sampleProduct = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  name: 'Widget',
  sku: 'W-001',
  barcode: null,
  price_cents: 1999,
  tax_rate: 10,
  stock_on_hand: 12,
  category_id: null,
  category_name: null,
  image_url: null,
  is_active: true,
  ...over,
});

describe('ItemsScreen', () => {
  test('renders empty state when there are no products', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: { data: [], meta: { current_page: 1, last_page: 1, per_page: 20, total: 0 } },
    });
    renderAt();
    await waitFor(() => expect(screen.getByText(/No products/i)).toBeInTheDocument());
  });

  test('renders rows and a clickable row navigates to /items/:id', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: {
        data: [sampleProduct({ id: 42, name: 'Doohickey', sku: 'D-42' })],
        meta: { current_page: 1, last_page: 1, per_page: 20, total: 1 },
      },
    });
    renderAt();
    await waitFor(() => expect(screen.getByText('Doohickey')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Doohickey'));
    await waitFor(() => expect(screen.getByText(/ProductDetail sentinel/)).toBeInTheDocument());
  });

  test('initial fetch hits products.list with default paging', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: { data: [], meta: { current_page: 1, last_page: 1, per_page: 20, total: 0 } },
    });
    renderAt();
    await waitFor(() =>
      expect(relayCallMock).toHaveBeenCalledWith('products.list', { page: 1, per_page: 20 }, undefined),
    );
  });

  test('debounced search switches to products.search after the delay', async () => {
    relayCallMock.mockResolvedValue({
      ok: true,
      data: { data: [], meta: { current_page: 1, last_page: 1, per_page: 20, total: 0 } },
    });
    renderAt();
    await waitFor(() =>
      expect(relayCallMock).toHaveBeenCalledWith('products.list', { page: 1, per_page: 20 }, undefined),
    );

    const input = screen.getByPlaceholderText(/Name, SKU, barcode/i);
    fireEvent.change(input, { target: { value: 'gizmo' } });

    // Before the debounce window elapses, no new call should fire.
    expect(relayCallMock).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(350);
    });

    await waitFor(() =>
      expect(relayCallMock).toHaveBeenCalledWith(
        'products.search',
        { query: 'gizmo', page: 1, per_page: 20 },
        undefined,
      ),
    );
  });
});
