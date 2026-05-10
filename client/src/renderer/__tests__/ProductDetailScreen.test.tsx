/** @jest-environment jsdom */
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { ProductDetailScreen } from '../screens/ProductDetailScreen';

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

function renderAt(path = '/items/42') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/items" element={<div>List sentinel</div>} />
        <Route path="/items/:id" element={<ProductDetailScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

const SAMPLE_PRODUCT = {
  id: 42,
  name: 'Widget Pro',
  sku: 'WP-001',
  barcode: '1234567890',
  price_cents: 4999,
  tax_rate: 10,
  stock_on_hand: 17,
  category_id: 3,
  category_name: 'Hardware',
  image_url: null,
  is_active: true,
  description: 'A premium widget.',
  cost_cents: 2000,
  stock_levels: [
    { location_id: 1, location_name: 'Main', on_hand: 10, committed: 0, available: 10 },
    { location_id: 2, location_name: 'Annex', on_hand: 7, committed: 1, available: 6 },
  ],
  variants: [],
};

describe('ProductDetailScreen', () => {
  test('renders product name, SKU, barcode, and price', async () => {
    relayCallMock.mockResolvedValue({ ok: true, data: SAMPLE_PRODUCT });
    renderAt();
    await waitFor(() => expect(screen.getByRole('heading', { name: /Widget Pro/ })).toBeInTheDocument());
    expect(screen.getByText('WP-001')).toBeInTheDocument();
    expect(screen.getByText('1234567890')).toBeInTheDocument();
    expect(screen.getByText(/49\.99/)).toBeInTheDocument();
    expect(screen.getByText('Main')).toBeInTheDocument();
    expect(screen.getByText('Annex')).toBeInTheDocument();
    expect(screen.getByText('A premium widget.')).toBeInTheDocument();
  });

  test('renders not-found state when relay returns null', async () => {
    relayCallMock.mockResolvedValue({ ok: true, data: null });
    renderAt();
    await waitFor(() => expect(screen.getByText(/Product not found/i)).toBeInTheDocument());
  });

  test('passes both id aliases to the relay (compat with dispatcher)', async () => {
    relayCallMock.mockResolvedValue({ ok: true, data: SAMPLE_PRODUCT });
    renderAt('/items/77');
    await waitFor(() =>
      expect(relayCallMock).toHaveBeenCalledWith(
        'products.detail',
        { product_id: 77, id: 77 },
        undefined,
      ),
    );
  });
});
