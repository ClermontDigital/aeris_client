/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PinSetupScreen } from '../screens/PinSetupScreen';
import { useAppLockStore } from '../stores/appLockStore';

const setPinMock = jest.fn();

beforeEach(() => {
  setPinMock.mockReset();
  Object.defineProperty(window, 'aeris', {
    configurable: true,
    value: {
      app: { version: jest.fn() },
      relay: { call: jest.fn() },
      auth: {
        getState: jest.fn(),
        login: jest.fn(),
        logout: jest.fn(),
        onStateChanged: jest.fn().mockReturnValue(() => undefined),
      },
      settings: { get: jest.fn(), set: jest.fn(), onChanged: jest.fn().mockReturnValue(() => undefined) },
      lock: {
        getState: jest.fn(),
        setPin: setPinMock,
        verifyPin: jest.fn(),
        clearPin: jest.fn(),
        lockNow: jest.fn(),
        onStateChanged: jest.fn().mockReturnValue(() => undefined),
      },
      diagnostics: { getRecentLogs: jest.fn() },
    },
  });
  useAppLockStore.setState({
    initialized: true,
    isPinSet: false,
    locked: false,
    attempts: 0,
    lockedOutUntilMs: null,
  });
});

function tapDigits(value: string) {
  for (const ch of value) {
    fireEvent.click(screen.getByRole('button', { name: `Digit ${ch}` }));
  }
}

describe('PinSetupScreen', () => {
  test('renders Set step with disabled Continue until 4 digits entered', () => {
    render(<PinSetupScreen />);
    expect(screen.getByText('Set a PIN')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    tapDigits('123');
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    tapDigits('4');
    expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();
  });

  test('mismatched confirm resets back to Set step with an error', () => {
    render(<PinSetupScreen />);
    tapDigits('1234');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Confirm your PIN')).toBeInTheDocument();
    tapDigits('5678');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByText('Set a PIN')).toBeInTheDocument();
    expect(screen.getByText(/PINs didn't match/i)).toBeInTheDocument();
  });

  test('matching confirm calls window.aeris.lock.setPin', async () => {
    setPinMock.mockResolvedValue({ ok: true });
    render(<PinSetupScreen />);
    tapDigits('1234');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    tapDigits('1234');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(setPinMock).toHaveBeenCalledWith('1234'));
  });

  test('backspace key removes the last digit', () => {
    render(<PinSetupScreen />);
    tapDigits('1234');
    fireEvent.click(screen.getByRole('button', { name: 'Backspace' }));
    // Continue should now be disabled again (3 digits).
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });
});
