/** @jest-environment jsdom */
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { Sidebar } from '../components/Sidebar';

describe('Sidebar', () => {
  test('renders all five nav items in the expected order with correct hrefs', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Sidebar />
      </MemoryRouter>,
    );

    const expected = [
      { label: 'Dashboard', href: '/' },
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
});
