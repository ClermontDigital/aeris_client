/** @jest-environment jsdom */
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { Sidebar } from '../components/Sidebar';
import { useCartStore } from '../stores/cartStore';

beforeEach(() => {
  try {
    localStorage.removeItem('aeris-cart');
  } catch {
    // ignore
  }
  useCartStore.getState().clear();
});

afterEach(() => {
  useCartStore.getState().clear();
});

const sampleProduct = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  name: 'Widget',
  sku: 'W-001',
  barcode: null,
  price_cents: 1000,
  tax_rate: 10,
  stock_on_hand: 100,
  category_id: null,
  category_name: null,
  image_url: null,
  is_active: true,
  ...over,
});

describe('Sidebar', () => {
  test('renders all nav items in the expected order with correct hrefs', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>,
    );

    const expected = [
      { label: 'Dashboard', href: '/' },
      { label: 'Day end', href: '/dashboard/eod' },
      { label: 'POS', href: '/pos' },
      { label: 'Items', href: '/items' },
      { label: 'Customers', href: '/customers' },
      { label: 'Transactions', href: '/transactions' },
      { label: 'Settings', href: '/settings' },
    ];

    expected.forEach(({ label, href }) => {
      const link = screen.getByRole('link', { name: label });
      expect(link).toHaveAttribute('href', href);
    });
  });

  test('renders the brand logo image (not text)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>,
    );
    const logo = screen.getByAltText('Aeris');
    expect(logo.tagName).toBe('IMG');
  });

  test('does not render a cart badge when the cart is empty', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(screen.queryByLabelText(/in cart/i)).not.toBeInTheDocument();
  });

  test('renders a cart badge with the item count when the cart has items', () => {
    useCartStore.getState().addItem(sampleProduct({ id: 1 }), 2);
    useCartStore.getState().addItem(sampleProduct({ id: 2 }), 1);
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>,
    );
    const badge = screen.getByLabelText(/3 items in cart/i);
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('3');
  });
});
