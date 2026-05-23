import React from 'react';
import {act, render, fireEvent} from '@testing-library/react-native';
import ErrorBanner from '../ErrorBanner';
import {useAuthStore} from '../../stores/authStore';

// Snapshot the initial auth store state once so every test can reset cleanly.
// The store's `create()` lives at module init time, so we capture state right
// after import and replay it between tests — otherwise a test that flips
// isAuthenticated would bleed into the next test's render.
const INITIAL_AUTH = useAuthStore.getState();

function setAuth(partial: Partial<ReturnType<typeof useAuthStore.getState>>): void {
  useAuthStore.setState(partial);
}

function resetAuth(): void {
  // Replace whole state — using `true` as the second arg to setState replaces
  // rather than merges. Keeps every field including action methods intact.
  useAuthStore.setState(INITIAL_AUTH, true);
}

describe('ErrorBanner', () => {
  beforeEach(() => {
    resetAuth();
    // Healthy auth baseline: most tests assume a logged-in session so the
    // suppression branch doesn't fire.
    setAuth({isAuthenticated: true, errorKind: null});
  });

  afterAll(() => {
    resetAuth();
  });

  it('renders the message', () => {
    const {getByText} = render(<ErrorBanner message="Network error" />);
    expect(getByText('Network error')).toBeTruthy();
  });

  it('fires onRetry when Retry tapped', () => {
    const onRetry = jest.fn();
    const {getByLabelText} = render(
      <ErrorBanner message="Failed to load" onRetry={onRetry} />,
    );
    fireEvent.press(getByLabelText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('fires onDismiss when the X button is tapped', () => {
    const onDismiss = jest.fn();
    const {getByLabelText} = render(
      <ErrorBanner message="Soft warning" tone="warning" onDismiss={onDismiss} />,
    );
    fireEvent.press(getByLabelText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders the message when auth is healthy', () => {
    setAuth({isAuthenticated: true, errorKind: null});
    const {queryByText} = render(<ErrorBanner message="Network error" />);
    expect(queryByText('Network error')).toBeTruthy();
  });

  it('returns null when auth is already wiped at render time', () => {
    setAuth({isAuthenticated: false, errorKind: 'expired'});
    const {queryByText} = render(
      <ErrorBanner message="Authentication expired" onRetry={() => {}} />,
    );
    // Banner suppresses itself entirely — neither message nor Retry should
    // be in the tree, so the operator never sees the stale copy during the
    // auth-stack fade.
    expect(queryByText('Authentication expired')).toBeNull();
  });

  it('re-renders and hides itself when auth is wiped after mount', () => {
    // Mount with healthy auth so the banner paints normally — this is the
    // ship-blocker case: screen catches 401, setError fires, banner mounts,
    // then onUnauthorized flips the store. The banner must observe the
    // flip and unmount its content rather than sitting on stale state.
    setAuth({isAuthenticated: true, errorKind: null});
    const {queryByText} = render(
      <ErrorBanner message="Authentication expired" onRetry={() => {}} />,
    );
    expect(queryByText('Authentication expired')).toBeTruthy();

    // Simulate the 401 → clearLocalSession path. The subscribe callback in
    // ErrorBanner fires forceTick which schedules a re-render; wrap in act
    // so RTL flushes the update before the assertion.
    act(() => {
      setAuth({isAuthenticated: false, errorKind: 'expired'});
    });

    expect(queryByText('Authentication expired')).toBeNull();
  });
});
