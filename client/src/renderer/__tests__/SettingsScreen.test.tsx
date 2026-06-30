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
const clearPinMock = jest.fn();
const getRecentLogsMock = jest.fn();
const printReceiptMock = jest.fn();
const printTestMock = jest.fn();

beforeEach(() => {
  logoutMock.mockReset();
  settingsSetMock.mockReset();
  lockNowMock.mockReset();
  clearPinMock.mockReset();
  getRecentLogsMock.mockReset();
  printReceiptMock.mockReset();
  printTestMock.mockReset();

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
        clearPin: clearPinMock.mockResolvedValue({ ok: true }),
        lockNow: lockNowMock,
        onStateChanged: jest.fn().mockReturnValue(() => undefined),
      },
      diagnostics: { getRecentLogs: getRecentLogsMock },
      print: {
        receipt: printReceiptMock.mockResolvedValue({ ok: true }),
        testPage: printTestMock.mockResolvedValue({ ok: true }),
      },
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
    // Multiple checkboxes on the screen since DR M3-E added the auto-failover
    // toggle. Pick the auto-lock one by its bound state (lockEnabled defaults
    // to true; autoFailoverEnabled defaults to false), then assert the click
    // flips that specific setting.
    const checkboxes = screen.getAllByRole('checkbox');
    const lockCheckbox = checkboxes.find((c) => (c as HTMLInputElement).checked);
    if (!lockCheckbox) throw new Error('expected an enabled checkbox (auto-lock)');
    fireEvent.click(lockCheckbox);
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

  test('Reset PIN shows a confirmation modal then triggers clearPin', () => {
    render(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Reset PIN/i }));
    expect(screen.getByText(/You'll be prompted to set a new PIN right away/i)).toBeInTheDocument();
    const confirms = screen.getAllByRole('button', { name: /Reset PIN/i });
    fireEvent.click(confirms[confirms.length - 1]);
    expect(clearPinMock).toHaveBeenCalled();
  });

  test('Printing section renders with printer-name input and test button', () => {
    render(<SettingsScreen />);
    expect(screen.getByRole('heading', { name: /Printing/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Receipt printer name/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Print test receipt/i }),
    ).toBeInTheDocument();
  });

  test('typing a printer name and blurring saves it via settings.set', async () => {
    render(<SettingsScreen />);
    const input = screen.getByLabelText(/Receipt printer name/i);
    fireEvent.change(input, { target: { value: 'EPSON-TM-T20' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(settingsSetMock).toHaveBeenCalledWith({ printerName: 'EPSON-TM-T20' }),
    );
  });

  test('blank printer name persists null (use system default)', async () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, workspaceCode: 'demo', printerName: 'Old' },
    });
    render(<SettingsScreen />);
    const input = screen.getByLabelText(/Receipt printer name/i);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(settingsSetMock).toHaveBeenCalledWith({ printerName: null }),
    );
  });

  test('Print test receipt invokes the print IPC and shows a success toast', async () => {
    render(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Print test receipt/i }));
    await waitFor(() => expect(printTestMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/Test page sent to the printer/i)).toBeInTheDocument(),
    );
  });

  test('Print test receipt shows error toast when print fails', async () => {
    printTestMock.mockResolvedValueOnce({ ok: false, message: 'No printer found' });
    render(<SettingsScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Print test receipt/i }));
    await waitFor(() =>
      expect(screen.getByText(/No printer found/i)).toBeInTheDocument(),
    );
  });

  test('Reset PIN button is hidden when no PIN is set', () => {
    useAppLockStore.setState({
      initialized: true,
      isPinSet: false,
      locked: false,
      attempts: 0,
      lockedOutUntilMs: null,
    });
    render(<SettingsScreen />);
    expect(screen.queryByRole('button', { name: /Reset PIN/i })).toBeNull();
  });
});
