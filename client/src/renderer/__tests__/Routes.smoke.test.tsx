/** @jest-environment jsdom */
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import { Routes } from '../router/Routes';
import { useAuthStore } from '../stores/authStore';
import { useAppLockStore } from '../stores/appLockStore';
import { useSettingsStore } from '../stores/settingsStore';
import { DEFAULT_SETTINGS } from '../../shared-types/ipc';

// Stub the window.aeris bridge so the stores can boot inside jsdom.
beforeEach(() => {
  (global as unknown as { window: Window }).window = global.window;
  Object.defineProperty(window, 'aeris', {
    configurable: true,
    value: {
      app: { version: jest.fn().mockResolvedValue('2.0.0-test') },
      relay: {
        call: jest.fn().mockResolvedValue({
          ok: true,
          data: {
            date: '2026-05-07',
            revenue_cents: 0,
            sales_count: 0,
            items_sold: 0,
            average_sale_cents: 0,
            top_products: [],
          },
        }),
      },
      auth: {
        getState: jest.fn(),
        login: jest.fn(),
        logout: jest.fn(),
        onStateChanged: jest.fn().mockReturnValue(() => undefined),
      },
      settings: {
        get: jest.fn().mockResolvedValue(DEFAULT_SETTINGS),
        set: jest.fn(),
        onChanged: jest.fn().mockReturnValue(() => undefined),
      },
      lock: {
        getState: jest.fn().mockResolvedValue({
          initialized: true,
          isPinSet: false,
          locked: false,
          attempts: 0,
          lockedOutUntilMs: null,
        }),
        setPin: jest.fn(),
        verifyPin: jest.fn(),
        clearPin: jest.fn(),
        lockNow: jest.fn(),
        onStateChanged: jest.fn().mockReturnValue(() => undefined),
      },
      diagnostics: {
        getRecentLogs: jest.fn().mockResolvedValue(''),
      },
    },
  });
});

afterEach(() => {
  // Reset zustand stores between tests.
  useAuthStore.setState({
    initialized: true,
    isAuthenticated: false,
    user: null,
    expiresAt: null,
    workspaceCode: '',
    errorKind: null,
  });
  useAppLockStore.setState({ initialized: true, isPinSet: false, locked: false, attempts: 0, lockedOutUntilMs: null });
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS });
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes />
    </MemoryRouter>,
  );
}

describe('Routes guard', () => {
  test('unauthenticated user at "/" is redirected to /login screen', () => {
    useAuthStore.setState({
      initialized: true,
      isAuthenticated: false,
      user: null,
      expiresAt: null,
      workspaceCode: '',
      errorKind: null,
    });
    renderAt('/');
    expect(screen.getByRole('button', { name: /Sign in/i })).toBeInTheDocument();
  });

  test('authenticated user at "/" renders Dashboard', () => {
    useAuthStore.setState({
      initialized: true,
      isAuthenticated: true,
      user: { id: 1, email: 'a@b.c' },
      expiresAt: null,
      workspaceCode: 'demo',
      errorKind: null,
    });
    useAppLockStore.setState({ initialized: true, isPinSet: true, locked: false, attempts: 0, lockedOutUntilMs: null });
    renderAt('/');
    expect(screen.getByRole('heading', { name: /Dashboard/i })).toBeInTheDocument();
  });

  test('locked authenticated user is redirected to /lock', () => {
    useAuthStore.setState({
      initialized: true,
      isAuthenticated: true,
      user: { id: 1, email: 'a@b.c' },
      expiresAt: null,
      workspaceCode: 'demo',
      errorKind: null,
    });
    useAppLockStore.setState({ initialized: true, isPinSet: true, locked: true, attempts: 0, lockedOutUntilMs: null });
    renderAt('/');
    expect(screen.getByRole('group', { name: /Unlock PIN keypad/i })).toBeInTheDocument();
  });

  test('authenticated user without a PIN sees PinSetup', () => {
    useAuthStore.setState({
      initialized: true,
      isAuthenticated: true,
      user: { id: 1, email: 'a@b.c' },
      expiresAt: null,
      workspaceCode: 'demo',
      errorKind: null,
    });
    useAppLockStore.setState({ initialized: true, isPinSet: false, locked: false, attempts: 0, lockedOutUntilMs: null });
    renderAt('/');
    expect(screen.getByText(/Set a PIN/i)).toBeInTheDocument();
  });

  test('unauthenticated user trying /transactions falls through to LoginScreen', () => {
    useAuthStore.setState({
      initialized: true,
      isAuthenticated: false,
      user: null,
      expiresAt: null,
      workspaceCode: '',
      errorKind: null,
    });
    renderAt('/transactions');
    expect(screen.getByRole('button', { name: /Sign in/i })).toBeInTheDocument();
  });

  test('settings screen renders for authenticated user', () => {
    useAuthStore.setState({
      initialized: true,
      isAuthenticated: true,
      user: { id: 1, email: 'a@b.c' },
      expiresAt: null,
      workspaceCode: 'demo',
      errorKind: null,
    });
    useAppLockStore.setState({ initialized: true, isPinSet: true, locked: false, attempts: 0, lockedOutUntilMs: null });
    renderAt('/settings');
    expect(screen.getByRole('heading', { name: /Settings/i })).toBeInTheDocument();
  });
});
