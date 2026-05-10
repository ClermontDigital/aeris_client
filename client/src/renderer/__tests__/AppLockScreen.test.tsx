/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AppLockScreen } from '../screens/AppLockScreen';
import { useAppLockStore } from '../stores/appLockStore';
import { useAuthStore } from '../stores/authStore';

const verifyPinMock = jest.fn();
const logoutMock = jest.fn();

beforeEach(() => {
  verifyPinMock.mockReset();
  logoutMock.mockReset();
  Object.defineProperty(window, 'aeris', {
    configurable: true,
    value: {
      app: { version: jest.fn() },
      relay: { call: jest.fn() },
      auth: {
        getState: jest.fn(),
        login: jest.fn(),
        logout: logoutMock,
        onStateChanged: jest.fn().mockReturnValue(() => undefined),
      },
      settings: { get: jest.fn(), set: jest.fn(), onChanged: jest.fn().mockReturnValue(() => undefined) },
      lock: {
        getState: jest.fn(),
        setPin: jest.fn(),
        verifyPin: verifyPinMock,
        clearPin: jest.fn(),
        lockNow: jest.fn(),
        onStateChanged: jest.fn().mockReturnValue(() => undefined),
      },
      diagnostics: { getRecentLogs: jest.fn() },
    },
  });
  useAppLockStore.setState({
    initialized: true,
    isPinSet: true,
    locked: true,
    attempts: 0,
    lockedOutUntilMs: null,
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
});

function tapDigits(value: string) {
  for (const ch of value) {
    fireEvent.click(screen.getByRole('button', { name: `Digit ${ch}` }));
  }
}

describe('AppLockScreen', () => {
  test('Unlock button disabled until 4 digits', () => {
    render(<AppLockScreen />);
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled();
    tapDigits('1234');
    expect(screen.getByRole('button', { name: 'Unlock' })).not.toBeDisabled();
  });

  test('verifyPin success leaves rendering in clean state', async () => {
    verifyPinMock.mockResolvedValue({ ok: true });
    render(<AppLockScreen />);
    tapDigits('1234');
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(verifyPinMock).toHaveBeenCalledWith('1234'));
  });

  test('wrong PIN shows attempts-remaining error', async () => {
    verifyPinMock.mockResolvedValue({ ok: false, attemptsRemaining: 2 });
    render(<AppLockScreen />);
    tapDigits('0000');
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(screen.getByText(/2 attempts remaining/i)).toBeInTheDocument());
  });

  test('lockedOutUntilMs in store renders the countdown banner and disables unlock', () => {
    useAppLockStore.setState({
      initialized: true,
      isPinSet: true,
      locked: true,
      attempts: 3,
      lockedOutUntilMs: Date.now() + 5 * 60 * 1000,
    });
    render(<AppLockScreen />);
    expect(screen.getByText(/Too many wrong attempts/i)).toBeInTheDocument();
    // Even with 4+ digits, unlock should remain disabled during cooldown.
    tapDigits('1234');
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled();
  });

  test('Sign out triggers window.aeris.auth.logout', () => {
    logoutMock.mockResolvedValue({});
    render(<AppLockScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logoutMock).toHaveBeenCalled();
  });
});
