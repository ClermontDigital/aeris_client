/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsScreen } from '../screens/SettingsScreen';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useAppLockStore } from '../stores/appLockStore';
import { DEFAULT_SETTINGS } from '../../shared-types/ipc';

const logoutMock = jest.fn();
const settingsSetMock = jest.fn();
const lockNowMock = jest.fn();
const getRecentLogsMock = jest.fn();

beforeEach(() => {
  logoutMock.mockReset();
  settingsSetMock.mockReset();
  lockNowMock.mockReset();
  getRecentLogsMock.mockReset();

  // jsdom doesn't ship a clipboard implementation by default.
  Object.assign(navigator, {
    clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
  });

  Object.defineProperty(window, 'aeris', {
    configurable: true,
    value: {
      app: { version: jest.fn().mockResolvedValue('2.0.0-test') },
      relay: { call: jest.fn() },
      auth: {
        getState: jest.fn(),
        login: jest.fn(),
        logout: logoutMock,
        onStateChanged: jest.fn().mockReturnValue(() => undefined),
      },
      settings: {
        get: jest.fn().mockResolvedValue(DEFAULT_SETTINGS),
        set: settingsSetMock.mockResolvedValue({ ...DEFAULT_SETTINGS, workspaceCode: 'demo' }),
        onChanged: jest.fn().mockReturnValue(() => undefined),
      },
      lock: {
        getState: jest.fn(),
        setPin: jest.fn(),
        verifyPin: jest.fn(),
        clearPin: jest.fn(),
        lockNow: lockNowMock,
        onStateChanged: jest.fn().mockReturnValue(() => undefined),
      },
      diagnostics: { getRecentLogs: getRecentLogsMock },
    },
  });

  useAuthStore.setState({
    initialized: true,
    isAuthenticated: true,
    user: { id: 1, email: 'a@b.c' },
    expiresAt: null,
    workspaceCode: 'demo',
    errorKind: null,
    isLoading: false,
  });
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, workspaceCode: 'demo' } });
  useAppLockStore.setState({
    initialized: true,
    isPinSet: true,
    locked: false,
    attempts: 0,
    lockedOutUntilMs: null,
  });
});

describe('SettingsScreen', () => {
  test('renders workspace + relay url + version', async () => {
    render(<SettingsScreen />);
    expect(screen.getByText('demo')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('2.0.0-test')).toBeInTheDocument());
  });

  test('toggling auto-lock writes to settings', () => {
    render(<SettingsScreen />);
    const cb = screen.getByRole('checkbox');
    fireEvent.click(cb);
    expect(settingsSetMock).toHaveBeenCalledWith({ lockEnabled: false });
  });

  test('Lock now triggers window.aeris.lock.lockNow', () => {
    render(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Lock now/i }));
    expect(lockNowMock).toHaveBeenCalled();
  });

  test('Send Diagnostics copies log lines to the clipboard and shows a toast', async () => {
    getRecentLogsMock.mockResolvedValue('log line 1\nlog line 2');
    const writeMock = navigator.clipboard.writeText as jest.Mock;
    render(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Send Diagnostics/i }));
    await waitFor(() => expect(writeMock).toHaveBeenCalledWith('log line 1\nlog line 2'));
    expect(screen.getByText(/Diagnostics copied to clipboard/i)).toBeInTheDocument();
  });

  test('Sign out shows a confirmation modal then triggers logout', () => {
    render(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Sign out/i }));
    // Modal renders; click confirm.
    const confirm = screen.getAllByRole('button', { name: /Sign out/i }).pop()!;
    fireEvent.click(confirm);
    expect(logoutMock).toHaveBeenCalled();
  });

  test('Change workspace shows a confirmation modal that signs out', () => {
    render(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Change workspace/i }));
    expect(screen.getByText(/Switching workspace will sign you out/i)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /Sign out/i }).pop()!);
    expect(logoutMock).toHaveBeenCalled();
  });
});
