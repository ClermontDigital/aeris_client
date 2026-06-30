import {renderHook} from '@testing-library/react-native';

// M3-B — useAutoFailback flag-gate + anti-flap.
// Proves: flag-OFF ≡ M2 (NEVER auto-switches, even on a ready failback), and
// flag-ON performs the swap exactly once (mirror of useAutoFailover's swap).
//
// We mock useRoutingDecision (the cascade is unit-tested elsewhere) and drive
// `reason`/`deferred` directly, plus the auth/settings stores' getState/setState
// and the silentReauth tail. Names referenced inside jest.mock() factories are
// `mock`-prefixed so Jest's hoisting allowlist permits them.

interface DecisionMock {
  reason: string;
  deferred: boolean;
}
const mockDecision: DecisionMock = {reason: 'cloud-primary', deferred: false};

interface SettingsMock {
  settings: {autoFailoverEnabled?: boolean; connectionMode?: 'direct' | 'relay'};
}
const mockSettings: SettingsMock = {
  settings: {autoFailoverEnabled: false, connectionMode: 'direct'},
};

const mockClearLocalSession = jest.fn(() => Promise.resolve());
const mockSaveSettings = jest.fn(() => Promise.resolve());
const mockSetAuthState = jest.fn();
const mockAuth = {isAuthenticated: true};

const mockAttemptSilentReauth = jest.fn(() =>
  Promise.resolve({outcome: 'reauthed' as const}),
);

jest.mock('../useRoutingDecision', () => ({
  useRoutingDecision: () => mockDecision,
}));
jest.mock('../../stores/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (sel: (s: SettingsMock) => unknown) => sel(mockSettings),
    {getState: () => ({saveSettings: mockSaveSettings})},
  ),
}));
jest.mock('../../stores/authStore', () => ({
  useAuthStore: Object.assign(() => undefined, {
    getState: () => ({
      clearLocalSession: mockClearLocalSession,
      isAuthenticated: mockAuth.isAuthenticated,
    }),
    setState: (...a: unknown[]) => mockSetAuthState(...a),
  }),
}));
jest.mock('../../services/silentReauth', () => ({
  attemptSilentReauth: () => mockAttemptSilentReauth(),
}));

import {useAutoFailback} from '../useAutoFailback';

function reset(): void {
  mockDecision.reason = 'cloud-primary';
  mockDecision.deferred = false;
  mockSettings.settings = {autoFailoverEnabled: false, connectionMode: 'direct'};
  mockAuth.isAuthenticated = true;
  mockClearLocalSession.mockClear();
  mockSaveSettings.mockClear();
  mockSetAuthState.mockClear();
  mockAttemptSilentReauth.mockClear();
}
beforeEach(reset);

// Let the hook's fire-and-forget async swap settle.
const flush = () => new Promise(r => setTimeout(r, 0));

describe('useAutoFailback — flag isolation (flag-off ≡ M2)', () => {
  it('flag OFF + failback-ready → NEVER auto-switches', async () => {
    mockSettings.settings.autoFailoverEnabled = false;
    mockDecision.reason = 'failback-ready';
    renderHook(() => useAutoFailback());
    await flush();
    expect(mockSaveSettings).not.toHaveBeenCalled();
    expect(mockClearLocalSession).not.toHaveBeenCalled();
  });

  it('flag OFF + failback-hold → no-op', async () => {
    mockSettings.settings.autoFailoverEnabled = false;
    mockDecision.reason = 'failback-hold';
    renderHook(() => useAutoFailback());
    await flush();
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });
});

describe('useAutoFailback — flag ON', () => {
  it('failback-ready (direct mode) → switches back to relay + silent re-auth', async () => {
    mockSettings.settings.autoFailoverEnabled = true;
    mockSettings.settings.connectionMode = 'direct';
    mockDecision.reason = 'failback-ready';
    renderHook(() => useAutoFailback());
    await flush();
    expect(mockClearLocalSession).toHaveBeenCalledTimes(1);
    expect(mockSaveSettings).toHaveBeenCalledWith({connectionMode: 'relay'});
    expect(mockAttemptSilentReauth).toHaveBeenCalledTimes(1);
  });

  it('does NOT switch while deferred (mid-transaction)', async () => {
    mockSettings.settings.autoFailoverEnabled = true;
    mockDecision.reason = 'failback-ready';
    mockDecision.deferred = true;
    renderHook(() => useAutoFailback());
    await flush();
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('failback-hold → no switch (anti-flap hold window not met)', async () => {
    mockSettings.settings.autoFailoverEnabled = true;
    mockDecision.reason = 'failback-hold';
    renderHook(() => useAutoFailback());
    await flush();
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('does not double-fire on re-render within one recovery (anti-flap latch)', async () => {
    mockSettings.settings.autoFailoverEnabled = true;
    mockSettings.settings.connectionMode = 'direct';
    mockDecision.reason = 'failback-ready';
    const {rerender} = renderHook(() => useAutoFailback());
    await flush();
    rerender({});
    await flush();
    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
  });
});
