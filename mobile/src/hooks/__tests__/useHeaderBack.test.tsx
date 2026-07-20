import {renderHook} from '@testing-library/react-native';

// Drives useHeaderBack in isolation. Proves the shared registration contract
// every drill-down screen relies on: register on focus, the double-fire guard,
// the #70 parent-tab-focus re-assert (only when this screen is still focused),
// and the identity-matched beforeRemove cleanup. Names referenced inside
// jest.mock() factories are `mock`-prefixed so Jest's hoisting allowlist
// permits them.

const mockSetOnBack = jest.fn();
const mockClearIf = jest.fn();

// Captured navigator listeners so the test can fire 'focus' / 'beforeRemove'.
const mockListeners: Record<string, Array<() => void>> = {};
const register = (event: string, cb: () => void) => {
  (mockListeners[event] ||= []).push(cb);
  return () => undefined;
};
const mockParent = {addListener: jest.fn(register)};
const mockGetParent = jest.fn(() => mockParent);
const mockIsFocused = jest.fn(() => true);
const mockNav = {
  getParent: mockGetParent,
  isFocused: mockIsFocused,
  addListener: jest.fn(register),
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNav,
  // Run the focus effect body immediately, like a focus event on mount.
  useFocusEffect: (cb: () => void | (() => void)) => {
    cb();
  },
}));
jest.mock('../../stores/headerBackStore', () => ({
  useHeaderBackStore: (sel: (s: unknown) => unknown) =>
    sel({setOnBack: mockSetOnBack, clearIf: mockClearIf}),
}));

import {useHeaderBack} from '../useHeaderBack';

const fire = (event: string) =>
  (mockListeners[event] || []).forEach(cb => cb());

describe('useHeaderBack', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(mockListeners)) delete mockListeners[k];
    mockIsFocused.mockReturnValue(true);
  });

  it('registers a back handler on focus that runs the caller handler', () => {
    const handler = jest.fn();
    renderHook(() => useHeaderBack(handler));

    expect(mockSetOnBack).toHaveBeenCalledTimes(1);
    const registered = mockSetOnBack.mock.calls[0][0] as () => void;
    registered();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('guards against a double-fire within a single focus', () => {
    const handler = jest.fn();
    renderHook(() => useHeaderBack(handler));
    const registered = mockSetOnBack.mock.calls[0][0] as () => void;

    registered();
    registered();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('re-asserts the handler when the parent tab regains focus (#70)', () => {
    renderHook(() => useHeaderBack(jest.fn()));
    mockSetOnBack.mockClear();

    mockIsFocused.mockReturnValue(true);
    fire('focus');
    expect(mockSetOnBack).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-assert on tab focus when this screen is not focused', () => {
    renderHook(() => useHeaderBack(jest.fn()));
    mockSetOnBack.mockClear();

    mockIsFocused.mockReturnValue(false);
    fire('focus');
    expect(mockSetOnBack).not.toHaveBeenCalled();
  });

  it('clears only its own slot on beforeRemove (identity-matched)', () => {
    renderHook(() => useHeaderBack(jest.fn()));
    const registered = mockSetOnBack.mock.calls[0][0] as () => void;

    fire('beforeRemove');
    expect(mockClearIf).toHaveBeenCalledWith(registered);
  });
});
