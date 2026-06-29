import { initRelayBridge, getDirectClient, isDirectMode } from '../relayBridge';
import { settingsStore } from '../settingsStore';
import { tokenStore } from '../tokenStore';
import { DEFAULT_SETTINGS } from '../../shared-types/ipc';
import StoreMock from 'electron-store';

// FIX 2 — cold-start (read-path) leg of the DR Direct/LAN baseUrl validator.
//
// The write-time gate (settingsStore.set) validates the Direct baseUrl on write
// and on a mode switch. It does NOT run at cold start, where initRelayBridge
// reads settings.baseUrl off disk and configures the DirectClient directly. If
// a malicious/legacy bad baseUrl is already persisted with
// connectionMode==='direct', the next renderer action would ship the bearer to
// that host with no switch (so §14.7 never fires). initRelayBridge must
// re-validate on read and fall back to relay mode, never configuring the Direct
// client (nor seeding its bearer) with the bad host.

// Seed the persisted settings bucket DIRECTLY (bypassing the write-time gate,
// exactly as a poisoned/legacy on-disk value would be present at boot).
function seedPersistedSettings(patch: Record<string, unknown>): void {
  const store = new StoreMock<{ settings: unknown }>({ name: 'aeris-settings' });
  (store as unknown as { set: (k: string, v: unknown) => void }).set(
    'settings',
    { ...DEFAULT_SETTINGS, ...patch },
  );
}

describe('relayBridge cold-start DR baseUrl gate', () => {
  beforeEach(() => {
    (StoreMock as unknown as { __resetAll: () => void }).__resetAll();
    settingsStore._reset();
    tokenStore._resetCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('cold-start with connectionMode=direct + INVALID persisted baseUrl falls back to relay and does NOT configure the Direct client with the bad URL', async () => {
    // A public (non-LAN) https host — would be rejected by isLocalUrlSafeForCache.
    const BAD_URL = 'https://evil.example.com';
    seedPersistedSettings({ connectionMode: 'direct', baseUrl: BAD_URL });

    const d = getDirectClient();
    const configureSpy = jest.spyOn(d, 'configure');
    const setTokenSpy = jest.spyOn(d, 'setAuthToken');
    // A token must be present so we can prove it is NOT seeded onto the Direct
    // client when the baseUrl is rejected.
    jest.spyOn(tokenStore, 'getToken').mockResolvedValue('bearer-xyz');

    await initRelayBridge();

    // Forced fallback to relay mode, persisted.
    expect(settingsStore.get().connectionMode).toBe('relay');
    expect(isDirectMode()).toBe(false);

    // The Direct client must never have been pointed at the bad host...
    for (const call of configureSpy.mock.calls) {
      expect(call[0]?.baseUrl).not.toBe(BAD_URL);
    }
    expect(d.getBaseUrl()).not.toBe(BAD_URL);
    // ...and the bearer must never have been applied to it.
    expect(setTokenSpy).not.toHaveBeenCalled();
    expect(d.getAuthToken()).toBeNull();
  });

  test('cold-start with connectionMode=direct + VALID persisted LAN baseUrl stays in direct mode and configures the Direct client', async () => {
    const GOOD_URL = 'https://192.168.1.10';
    seedPersistedSettings({ connectionMode: 'direct', baseUrl: GOOD_URL });

    const d = getDirectClient();
    jest.spyOn(tokenStore, 'getToken').mockResolvedValue('bearer-xyz');

    await initRelayBridge();

    expect(settingsStore.get().connectionMode).toBe('direct');
    expect(isDirectMode()).toBe(true);
    expect(d.getBaseUrl()).toBe(GOOD_URL);
    expect(d.getAuthToken()).toBe('bearer-xyz');
  });
});
