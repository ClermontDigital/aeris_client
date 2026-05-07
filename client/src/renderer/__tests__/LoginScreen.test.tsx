/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginScreen } from '../screens/LoginScreen';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { DEFAULT_SETTINGS } from '../../shared-types/ipc';

const loginMock = jest.fn();

beforeEach(() => {
  loginMock.mockReset();
  Object.defineProperty(window, 'aeris', {
    configurable: true,
    value: {
      app: { version: jest.fn().mockResolvedValue('2.0.0-test') },
      relay: { call: jest.fn() },
      auth: {
        getState: jest.fn(),
        login: loginMock,
        logout: jest.fn(),
        onStateChanged: jest.fn().mockReturnValue(() => undefined),
      },
      settings: {
        get: jest.fn().mockResolvedValue(DEFAULT_SETTINGS),
        set: jest.fn(),
        onChanged: jest.fn().mockReturnValue(() => undefined),
      },
      lock: {
        getState: jest.fn(),
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
  useAuthStore.setState({
    initialized: true,
    isAuthenticated: false,
    user: null,
    expiresAt: null,
    workspaceCode: '',
    errorKind: null,
    isLoading: false,
  });
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS });
});

describe('LoginScreen', () => {
  test('renders workspace, email, password fields and a disabled Sign in button initially', () => {
    render(<LoginScreen />);
    expect(screen.getByLabelText(/Workspace/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign in/i })).toBeDisabled();
  });

  test('submit is enabled once workspace + email + password are valid', () => {
    render(<LoginScreen />);
    fireEvent.change(screen.getByLabelText(/Workspace/i), { target: { value: 'acme-prod' } });
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'me@aeris' } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'pw' } });
    expect(screen.getByRole('button', { name: /Sign in/i })).not.toBeDisabled();
  });

  test('shows an inline workspace error for invalid format on blur', () => {
    render(<LoginScreen />);
    const ws = screen.getByLabelText(/Workspace/i);
    fireEvent.change(ws, { target: { value: 'a' } });
    fireEvent.blur(ws);
    expect(screen.getByText(/3–32 characters/i)).toBeInTheDocument();
  });

  test('lowercase-coerces workspace input', () => {
    render(<LoginScreen />);
    const ws = screen.getByLabelText(/Workspace/i) as HTMLInputElement;
    fireEvent.change(ws, { target: { value: 'ACME' } });
    expect(ws.value).toBe('acme');
  });

  test('clicking Sign in calls window.aeris.auth.login with trimmed values', async () => {
    loginMock.mockResolvedValue({
      initialized: true,
      isAuthenticated: true,
      user: { id: 1, email: 'me@aeris' },
      expiresAt: null,
      workspaceCode: 'acme-prod',
      errorKind: null,
    });
    render(<LoginScreen />);
    fireEvent.change(screen.getByLabelText(/Workspace/i), { target: { value: 'acme-prod' } });
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: ' me@aeris ' } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));
    await waitFor(() => expect(loginMock).toHaveBeenCalledTimes(1));
    expect(loginMock).toHaveBeenCalledWith({
      workspaceCode: 'acme-prod',
      email: 'me@aeris',
      password: 'pw',
    });
  });

  test('renders the invalid-credentials banner when errorKind=invalid', () => {
    useAuthStore.setState({
      initialized: true,
      isAuthenticated: false,
      user: null,
      expiresAt: null,
      workspaceCode: '',
      errorKind: 'invalid',
      isLoading: false,
    });
    render(<LoginScreen />);
    expect(screen.getByText(/Workspace, email, or password is incorrect/i)).toBeInTheDocument();
  });

  test('renders the expired banner when errorKind=expired', () => {
    useAuthStore.setState({
      initialized: true,
      isAuthenticated: false,
      user: null,
      expiresAt: null,
      workspaceCode: '',
      errorKind: 'expired',
      isLoading: false,
    });
    render(<LoginScreen />);
    expect(screen.getByText(/session has expired/i)).toBeInTheDocument();
  });

  test('renders the network banner when errorKind=network', () => {
    useAuthStore.setState({
      initialized: true,
      isAuthenticated: false,
      user: null,
      expiresAt: null,
      workspaceCode: '',
      errorKind: 'network',
      isLoading: false,
    });
    render(<LoginScreen />);
    expect(screen.getByText(/Couldn't reach the server/i)).toBeInTheDocument();
  });

  test('pre-fills workspace from persisted settings', () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, workspaceCode: 'pre-filled' },
    });
    render(<LoginScreen />);
    const ws = screen.getByLabelText(/Workspace/i) as HTMLInputElement;
    expect(ws.value).toBe('pre-filled');
  });
});
