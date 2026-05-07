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
      relay: { call: jest.fn() },
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
  useAppLockStore.setState({ locked: false, pinConfigured: false });
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
    expect(screen.getByText(/Phase 3 will build the workspace/i)).toBeInTheDocument();
  });

  test('authenticated user at "/" renders Dashboard placeholder', () => {
    useAuthStore.setState({
      initialized: true,
      isAuthenticated: true,
      user: { id: 1, email: 'a@b.c' },
      expiresAt: null,
      workspaceCode: 'demo',
      errorKind: null,
    });
    renderAt('/');
    expect(screen.getByText(/daily summary, recent transactions/i)).toBeInTheDocument();
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
    useAppLockStore.setState({ locked: true, pinConfigured: true });
    renderAt('/');
    expect(screen.getByText(/Locked/i)).toBeInTheDocument();
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
    expect(screen.getByText(/Phase 3 will build the workspace/i)).toBeInTheDocument();
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
    renderAt('/settings');
    expect(screen.getByRole('heading', { name: /Settings/i })).toBeInTheDocument();
  });
});
