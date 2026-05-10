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

  test('initialize() does not wait on slow relay validation before flipping initialized=true (#M3)', async () => {
    // Persist a token + user so doInitialize takes the optimistic-session path.
    await tokenStore.setToken('persisted-token');
    await tokenStore.setUser({ id: 1, name: 'Me', email: 'me@aeris', role: 'cashier' });
    await tokenStore.setExpiresAt('2030-01-01');

    const c = getRelayClient();
    let resolveSummary: ((v: unknown) => void) | null = null;
    jest.spyOn(c, 'getDailySummary').mockImplementation(
      () =>
        new Promise<never>((res) => {
          resolveSummary = res as (v: unknown) => void;
        }),
    );

    const initPromise = authManager.initialize();
    // Give the microtask queue time to drain through the synchronous
    // tokenStore reads + the immediate setState.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // initialize() is still pending on the unresolved getDailySummary,
    // but state should already reflect optimistic auth.
    const optimistic = authManager.getState();
    expect(optimistic.initialized).toBe(true);
    expect(optimistic.isAuthenticated).toBe(true);
    expect(optimistic.errorKind).toBeNull();

    // Now resolve the validation — initialize() completes cleanly.
    resolveSummary!(undefined);
    await initPromise;
    expect(authManager.getState().errorKind).toBeNull();
  });

  test('initialize() with 401 on cold-start still resolves readyPromise (auth:get-state does not hang)', async () => {
    await tokenStore.setToken('expired-token');
    await tokenStore.setUser({ id: 1, name: 'Me', email: 'me@aeris', role: 'cashier' });
    await tokenStore.setExpiresAt('2030-01-01');

    const c = getRelayClient();
    const err = new Error('expired') as Error & { status: number };
    err.status = 401;
    jest.spyOn(c, 'getDailySummary').mockRejectedValue(err);

    // Kick off init in the background.
    const initPromise = authManager.initialize();

    // auth:get-state must resolve within a tight window even though
    // getDailySummary rejected — readyPromise has to fire on every branch.
    const getStateResult = await Promise.race([
      (async () => {
        await initPromise;
        return authManager.getState();
      })(),
      new Promise<'timeout'>((res) => setTimeout(() => res('timeout'), 1000)),
    ]);
    expect(getStateResult).not.toBe('timeout');
  });

  test('initialize() validation network error keeps the optimistic session + errorKind=network (#M3)', async () => {
    await tokenStore.setToken('persisted-token');
    await tokenStore.setUser({ id: 1, name: 'Me', email: 'me@aeris', role: 'cashier' });
    await tokenStore.setExpiresAt('2030-01-01');

    const c = getRelayClient();
    jest.spyOn(c, 'getDailySummary').mockRejectedValue(new Error('offline'));
    await authManager.initialize();
    const s = authManager.getState();
    expect(s.initialized).toBe(true);
    expect(s.isAuthenticated).toBe(true);
    expect(s.errorKind).toBe('network');
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
