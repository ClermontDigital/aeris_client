import { ipcMain } from 'electron';
import { initRelayBridge, getRelayClient } from '../relayBridge';
import * as authManager from '../authManager';
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
});
