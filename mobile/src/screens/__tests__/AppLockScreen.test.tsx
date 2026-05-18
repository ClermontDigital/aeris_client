import React from 'react';
import {render} from '@testing-library/react-native';
import {BackHandler, Platform} from 'react-native';

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

    const {unmount} = render(<AppLockScreen />);

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

    render(<AppLockScreen />);

    expect(addSpy).not.toHaveBeenCalled();
  });
});
