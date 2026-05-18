import { ipcMain } from 'electron';
import { initRelayBridge, getRelayClient } from '../relayBridge';
import * as authManager from '../authManager';
import * as appLockManager from '../appLockManager';
import { settingsStore } from '../settingsStore';
import { tokenStore } from '../tokenStore';
import StoreMock from 'electron-store';

describe('authManager', () => {
  beforeEach(async () => {
    (StoreMock as unknown as { __resetAll: () => void }).__resetAll();
    settingsStore._reset();
    tokenStore._resetCache();
    (ipcMain as unknown as { __reset: () => void }).__reset();
    authManager._resetForTests();
    appLockManager._resetForTests();
    await initRelayBridge();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('login persists token + user and flips isAuthenticated', async () => {
    const c = getRelayClient();
    jest.spyOn(c, 'login').mockResolvedValue({
      access_token: 'tok-xyz',
      token_type: 'Bearer',
      expires_at: '2030-01-01',
      user: { id: 1, name: 'Me', email: 'me@aeris', role: 'cashier', location_id: null },
    });

    const next = await authManager.login({
      workspaceCode: 'demo',
      email: 'me@aeris',
      password: 'pw',
    });
    expect(next.isAuthenticated).toBe(true);
    expect(next.user?.email).toBe('me@aeris');
    expect(c.getAuthToken()).toBe('tok-xyz');
    expect(await tokenStore.getToken()).toBe('tok-xyz');
  });

  test('login with empty fields returns invalid errorKind without calling relay', async () => {
    const c = getRelayClient();
    const spy = jest.spyOn(c, 'login');
    const next = await authManager.login({
      workspaceCode: '',
      email: '',
      password: '',
    });
    expect(next.errorKind).toBe('invalid');
    expect(next.isAuthenticated).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  test('login network failure sets errorKind=network', async () => {
    const c = getRelayClient();
    jest.spyOn(c, 'login').mockRejectedValue(new Error('offline'));
    const next = await authManager.login({
      workspaceCode: 'demo',
      email: 'me@aeris',
      password: 'pw',
    });
    expect(next.errorKind).toBe('network');
    expect(next.isAuthenticated).toBe(false);
  });

  test('login 401 sets errorKind=invalid', async () => {
    const c = getRelayClient();
    const err = new Error('bad') as Error & { status: number };
    err.status = 401;
    jest.spyOn(c, 'login').mockRejectedValue(err);
    const next = await authManager.login({
      workspaceCode: 'demo',
      email: 'me@aeris',
      password: 'pw',
    });
    expect(next.errorKind).toBe('invalid');
  });

  test('handleUnauthorized wipes token + sets errorKind=expired', async () => {
    await tokenStore.setToken('to-be-wiped');
    getRelayClient().setAuthToken('to-be-wiped');
    await authManager.handleUnauthorized();
    expect(getRelayClient().getAuthToken()).toBeNull();
    expect(await tokenStore.getToken()).toBeNull();
    expect(authManager.getState().errorKind).toBe('expired');
    expect(authManager.getState().isAuthenticated).toBe(false);
  });

  test('logout clears server-side + local state best-effort', async () => {
    const c = getRelayClient();
    jest.spyOn(c, 'logout').mockResolvedValue(undefined);
    await tokenStore.setToken('abc');
    c.setAuthToken('abc');

    const next = await authManager.logout();
    expect(next.isAuthenticated).toBe(false);
    expect(await tokenStore.getToken()).toBeNull();
    expect(c.getAuthToken()).toBeNull();
  });

  test('initialize() restores optimistic session without firing a probe call', async () => {
    // Persist a token + user so doInitialize takes the restore path.
    await tokenStore.setToken('persisted-token');
    await tokenStore.setUser({ id: 1, name: 'Me', email: 'me@aeris', role: 'cashier' });
    await tokenStore.setExpiresAt('2030-01-01');

    const c = getRelayClient();
    const summarySpy = jest.spyOn(c, 'getDailySummary');

    await authManager.initialize();
    const s = authManager.getState();
    expect(s.initialized).toBe(true);
    expect(s.isAuthenticated).toBe(true);
    expect(s.user?.email).toBe('me@aeris');
    expect(s.errorKind).toBeNull();
    expect(c.getAuthToken()).toBe('persisted-token');
    // The duplicate cold-start validation that previously surfaced as a
    // spurious "Couldn't reach the server" banner is gone — the renderer's
    // first real query drives 401 detection via onUnauthorized.
    expect(summarySpy).not.toHaveBeenCalled();
  });

  test('initialize() with no persisted token resolves to unauthenticated', async () => {
    await authManager.initialize();
    const s = authManager.getState();
    expect(s.initialized).toBe(true);
    expect(s.isAuthenticated).toBe(false);
    expect(s.errorKind).toBeNull();
    expect(getRelayClient().getAuthToken()).toBeNull();
  });

  test('auth:get-state IPC awaits initialize() so renderer never reads pre-init state', async () => {
    await tokenStore.setToken('persisted-token');
    await tokenStore.setUser({ id: 1, name: 'Me', email: 'me@aeris', role: 'cashier' });
    await tokenStore.setExpiresAt('2030-01-01');

    authManager.registerAuthIpc();
    const handler = (ipcMain as unknown as {
      __invoke: (channel: string) => Promise<unknown>;
    }).__invoke('auth:get-state');
    // Even though we never called initialize() directly, the handler must
    // kick + await it so the returned state is coherent (initialized: true,
    // isAuthenticated: true).
    const state = (await handler) as { initialized: boolean; isAuthenticated: boolean };
    expect(state.initialized).toBe(true);
    expect(state.isAuthenticated).toBe(true);
  });

  test('logout preserves the PIN across login cycles', async () => {
    const c = getRelayClient();
    jest.spyOn(c, 'login').mockResolvedValue({
      access_token: 'tok-abc',
      token_type: 'Bearer',
      expires_at: '2030-01-01',
      user: { id: 1, name: 'Me', email: 'me@aeris', role: 'cashier', location_id: null },
    });
    jest.spyOn(c, 'logout').mockResolvedValue(undefined);

    await authManager.login({ workspaceCode: 'demo', email: 'me@aeris', password: 'pw' });
    await appLockManager.setPin('1234');
    expect(appLockManager.getAppLockState().isPinSet).toBe(true);

    await authManager.logout();
    expect(appLockManager.getAppLockState().isPinSet).toBe(true);

    await authManager.login({ workspaceCode: 'demo', email: 'me@aeris', password: 'pw' });
    expect(appLockManager.getAppLockState().isPinSet).toBe(true);
  });
});
