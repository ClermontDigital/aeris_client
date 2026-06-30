import {useAuthStore} from '../authStore';
import {useAppLockStore} from '../appLockStore';
import {useSettingsStore} from '../settingsStore';
import {useDrStore} from '../drStore';
import ApiClient from '../../services/ApiClient';
import {SilentReauthCredentialStore} from '../../services/SilentReauthCredentialStore';

describe('authStore.logout PIN policy', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: {id: 1, name: 'A', email: 'a@e.com', role: 'cashier', location_id: null},
      token: 'TOKEN',
      expiresAt: null,
      isAuthenticated: true,
      isLoading: false,
      error: null,
      errorKind: null,
      refreshInFlight: null,
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does NOT call useAppLockStore.reset() on logout (PIN persists across logout)', async () => {
    // ApiClient.logout would attempt a network call; stub to avoid it.
    jest.spyOn(ApiClient, 'logout').mockResolvedValueOnce(undefined as any);
    const resetSpy = jest.spyOn(useAppLockStore.getState(), 'reset');

    await useAuthStore.getState().logout();

    expect(resetSpy).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().token).toBeNull();
  });
});

// M3-C — the silent-reauth credential cache lifecycle, wired through the real
// store actions (login saves when flag live; logout + flushForRepair clear).
describe('M3-C silent-reauth credential cache lifecycle', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        autoFailoverEnabled: false,
        workspaceCode: 'shop-a',
      },
    } as any);
  });

  it('(a) login → credential is cached when the auto-failover flag is LIVE', async () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        autoFailoverEnabled: true,
        workspaceCode: 'shop-a',
        keepSignedIn: false,
      },
    } as any);
    jest.spyOn(ApiClient, 'configure').mockImplementation(() => undefined as any);
    jest.spyOn(ApiClient, 'setAuthToken').mockImplementation(() => undefined as any);
    jest.spyOn(ApiClient, 'login').mockResolvedValueOnce({
      access_token: 'TKN',
      expires_at: null,
      user: {
        id: 1,
        name: 'A',
        email: 'a@e.com',
        role: 'cashier',
        location_id: null,
      },
    } as any);
    const saveSpy = jest
      .spyOn(SilentReauthCredentialStore, 'save')
      .mockResolvedValue(undefined);

    await useAuthStore.getState().login('a@e.com', 'pw');

    expect(saveSpy).toHaveBeenCalledWith(true, 'shop-a', 'a@e.com', 'pw');
  });

  it('(a2) login → does NOT cache when the flag is OFF (save called with enabled=false ⇒ no-op)', async () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        autoFailoverEnabled: false,
        workspaceCode: 'shop-a',
        keepSignedIn: false,
      },
    } as any);
    jest.spyOn(ApiClient, 'configure').mockImplementation(() => undefined as any);
    jest.spyOn(ApiClient, 'setAuthToken').mockImplementation(() => undefined as any);
    jest.spyOn(ApiClient, 'login').mockResolvedValueOnce({
      access_token: 'TKN',
      expires_at: null,
      user: {
        id: 1,
        name: 'A',
        email: 'a@e.com',
        role: 'cashier',
        location_id: null,
      },
    } as any);
    const saveSpy = jest
      .spyOn(SilentReauthCredentialStore, 'save')
      .mockResolvedValue(undefined);

    await useAuthStore.getState().login('a@e.com', 'pw');

    // save() is still invoked but with enabled=false — the gate lives inside
    // save() so the flag-off build provably caches nothing.
    expect(saveSpy).toHaveBeenCalledWith(false, 'shop-a', 'a@e.com', 'pw');
  });

  it('(b) logout → the cached credential is cleared', async () => {
    jest.spyOn(ApiClient, 'logout').mockResolvedValueOnce(undefined as any);
    const clearSpy = jest
      .spyOn(SilentReauthCredentialStore, 'clear')
      .mockResolvedValue(undefined);

    await useAuthStore.getState().logout();

    expect(clearSpy).toHaveBeenCalled();
  });

  it('(c) flushForRepair (re-pair) → the cached credential is cleared', async () => {
    const clearSpy = jest
      .spyOn(SilentReauthCredentialStore, 'clear')
      .mockResolvedValue(undefined);

    await useDrStore.getState().flushForRepair();

    expect(clearSpy).toHaveBeenCalled();
  });
});
