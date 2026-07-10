import React from 'react';
import {render, waitFor} from '@testing-library/react-native';
import {BackHandler, Platform} from 'react-native';
import {useAppLockStore} from '../../stores/appLockStore';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';

const metrics = initialWindowMetrics ?? {
  frame: {x: 0, y: 0, width: 390, height: 844},
  insets: {top: 47, left: 0, right: 0, bottom: 34},
};

// AppLockScreen reads useSafeAreaInsets for the vault-door geometry, so it must
// render under a provider.
function renderLock() {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <AppLockScreen />
    </SafeAreaProvider>,
  );
}

beforeAll(() => {
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = {};
  }
  if (typeof (globalThis as any).window.dispatchEvent !== 'function') {
    (globalThis as any).window.dispatchEvent = () => true;
    (globalThis as any).window.addEventListener = () => undefined;
    (globalThis as any).window.removeEventListener = () => undefined;
    (globalThis as any).window.ErrorEvent = class {};
  }
});

// Direct store stub — see CartScreen.test.tsx for why we sidestep zustand
// under jest-expo + RTL.
jest.mock('../../stores/appLockStore', () => {
  const state = {
    initialized: true,
    isLocked: true,
    hasPin: true,
    biometricEnabled: false,
    biometricAvailable: false,
    failedAttempts: 0,
    init: jest.fn(),
    lockNow: jest.fn(),
    unlock: jest.fn(),
    recordFailedAttempt: jest.fn(() => 1),
    resetAttempts: jest.fn(),
    setPin: jest.fn(),
    verifyPin: jest.fn(),
    setBiometricEnabled: jest.fn(),
    reset: jest.fn(),
  };
  const useAppLockStore: any = (selector?: any) =>
    typeof selector === 'function' ? selector(state) : state;
  useAppLockStore.getState = () => state;
  useAppLockStore.setState = jest.fn();
  useAppLockStore.subscribe = () => () => undefined;
  return {useAppLockStore};
});

jest.mock('../../stores/authStore', () => {
  const state = {logout: jest.fn()};
  const useAuthStore: any = (selector?: any) =>
    typeof selector === 'function' ? selector(state) : state;
  useAuthStore.getState = () => state;
  return {useAuthStore};
});

jest.mock('../../services/AppLockService', () => ({
  __esModule: true,
  default: {
    getBiometricLabel: jest.fn(() => Promise.resolve('Face ID')),
    authenticateWithBiometrics: jest.fn(() => Promise.resolve(true)),
  },
}));

jest.mock('../../hooks/useHaptics', () => {
  const stable = {
    light: jest.fn(),
    medium: jest.fn(),
    selection: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
  };
  return {useHaptics: () => stable};
});

import AppLockScreen from '../AppLockScreen';

describe('AppLockScreen BackHandler', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', {value: originalOS, configurable: true});
    jest.restoreAllMocks();
  });

  it('registers a hardwareBackPress listener that swallows the event while mounted (Android)', () => {
    Object.defineProperty(Platform, 'OS', {value: 'android', configurable: true});
    const remove = jest.fn();
    const addSpy = jest
      .spyOn(BackHandler, 'addEventListener')
      .mockReturnValue({remove} as any);

    const {unmount} = renderLock();

    expect(addSpy).toHaveBeenCalledWith('hardwareBackPress', expect.any(Function));
    // Block-while-locked: the registered handler must return true so the
    // navigator below the overlay never sees the back press.
    const handler = addSpy.mock.calls[0][1] as () => boolean;
    expect(handler()).toBe(true);

    unmount();
    expect(remove).toHaveBeenCalled();
  });

  it('does not register the BackHandler on iOS', () => {
    Object.defineProperty(Platform, 'OS', {value: 'ios', configurable: true});
    const addSpy = jest.spyOn(BackHandler, 'addEventListener');

    renderLock();

    expect(addSpy).not.toHaveBeenCalled();
  });

  it('plays the vault-door unlock and calls unlock() when the doors finish opening', async () => {
    // A successful biometric on mount → beginUnlock → the door timing runs and,
    // on completion, unlock() fires (the exit hand-off, not an instant unlock).
    const store = useAppLockStore.getState() as unknown as {
      biometricEnabled: boolean;
      unlock: jest.Mock;
    };
    store.biometricEnabled = true;
    store.unlock.mockClear();
    try {
      renderLock();
      await waitFor(() => expect(store.unlock).toHaveBeenCalledTimes(1));
    } finally {
      store.biometricEnabled = false; // don't leak into the other tests
    }
  });
});
