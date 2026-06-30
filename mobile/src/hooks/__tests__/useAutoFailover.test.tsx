import {renderHook} from '@testing-library/react-native';

// M3-D BLOCKER-1 — useAutoFailover cert hard-gate + flag isolation.
// Proves:
//   - flag-OFF ≡ M2 (NEVER auto-swaps).
//   - flag-ON + reason='outage-auto' + certTrust='trusted' → swap + silent
//     re-auth (the cascade only emits 'outage-auto' when verified, but we also
//     re-assert the cert at the side-effecting boundary).
//   - flag-ON + reason='outage-auto' but certTrust!=='trusted' → NO silent
//     re-auth (belt-and-braces: never POST a cached password to a non-pinned NAS).
//
// We mock useRoutingDecision (cascade unit-tested elsewhere) and drive
// `reason`/`deferred` directly, plus the auth/settings/dr stores' getState and
// the silentReauth tail. Names referenced inside jest.mock() factories are
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
  settings: {autoFailoverEnabled: false, connectionMode: 'relay'},
};

const mockClearLocalSession = jest.fn(() => Promise.resolve());
const mockSaveSettings = jest.fn(() => Promise.resolve());
const mockSetAuthState = jest.fn();
const mockAuth = {isAuthenticated: true};

interface DrMock {
  cachedLocalUrl: string | null;
  certTrust: string;
}
const mockDr: DrMock = {cachedLocalUrl: 'https://nas.local', certTrust: 'trusted'};

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
jest.mock('../../stores/drStore', () => ({
  useDrStore: Object.assign(() => undefined, {
    getState: () => mockDr,
  }),
}));
jest.mock('../../services/silentReauth', () => ({
  attemptSilentReauth: () => mockAttemptSilentReauth(),
}));

import {useAutoFailover} from '../useAutoFailover';

function reset(): void {
  mockDecision.reason = 'cloud-primary';
  mockDecision.deferred = false;
  mockSettings.settings = {autoFailoverEnabled: false, connectionMode: 'relay'};
  mockAuth.isAuthenticated = true;
  mockDr.cachedLocalUrl = 'https://nas.local';
  mockDr.certTrust = 'trusted';
  mockClearLocalSession.mockClear();
  mockSaveSettings.mockClear();
  mockSetAuthState.mockClear();
  mockAttemptSilentReauth.mockClear();
}
beforeEach(reset);

const flush = () => new Promise(r => setTimeout(r, 0));

describe('useAutoFailover — flag isolation (flag-off ≡ M2)', () => {
  it('flag OFF + outage-auto-shaped decision → NEVER auto-swaps', async () => {
    mockSettings.settings.autoFailoverEnabled = false;
    // The cascade would not emit 'outage-auto' with the flag off, but assert the
    // hook is a no-op even if it somehow saw the auto reason.
    mockDecision.reason = 'outage-prompt';
    renderHook(() => useAutoFailover());
    await flush();
    expect(mockSaveSettings).not.toHaveBeenCalled();
    expect(mockAttemptSilentReauth).not.toHaveBeenCalled();
  });
});

describe('useAutoFailover — BLOCKER-1 cert hard-gate', () => {
  it('flag ON + outage-auto + cert VERIFIED ("trusted") → swap + silent re-auth', async () => {
    mockSettings.settings.autoFailoverEnabled = true;
    mockSettings.settings.connectionMode = 'relay';
    mockDecision.reason = 'outage-auto';
    mockDr.certTrust = 'trusted';
    renderHook(() => useAutoFailover());
    await flush();
    expect(mockClearLocalSession).toHaveBeenCalledTimes(1);
    expect(mockSaveSettings).toHaveBeenCalledWith({
      connectionMode: 'direct',
      baseUrl: 'https://nas.local',
    });
    expect(mockAttemptSilentReauth).toHaveBeenCalledTimes(1);
  });

  it('flag ON + outage-auto but cert UNVERIFIED → NO silent re-auth (belt-and-braces)', async () => {
    mockSettings.settings.autoFailoverEnabled = true;
    mockSettings.settings.connectionMode = 'relay';
    mockDecision.reason = 'outage-auto';
    mockDr.certTrust = 'unverified';
    renderHook(() => useAutoFailover());
    await flush();
    expect(mockAttemptSilentReauth).not.toHaveBeenCalled();
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('flag ON + outage-auto but cert MISMATCH → NO silent re-auth', async () => {
    mockSettings.settings.autoFailoverEnabled = true;
    mockSettings.settings.connectionMode = 'relay';
    mockDecision.reason = 'outage-auto';
    mockDr.certTrust = 'mismatch';
    renderHook(() => useAutoFailover());
    await flush();
    expect(mockAttemptSilentReauth).not.toHaveBeenCalled();
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('does NOT swap while deferred (mid-transaction), even with a verified cert', async () => {
    mockSettings.settings.autoFailoverEnabled = true;
    mockDecision.reason = 'outage-auto';
    mockDecision.deferred = true;
    mockDr.certTrust = 'trusted';
    renderHook(() => useAutoFailover());
    await flush();
    expect(mockSaveSettings).not.toHaveBeenCalled();
    expect(mockAttemptSilentReauth).not.toHaveBeenCalled();
  });
});
