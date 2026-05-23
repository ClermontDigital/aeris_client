import ApiClient, {RelayError} from '../services/ApiClient';
import {useAuthStore} from '../stores/authStore';
import {useSettingsStore} from '../stores/settingsStore';
import {SecureStorage} from '../services/StorageService';
import type {AuthResponse} from '../types/api.types';

const AUTH_TOKEN_KEY = 'aeris_auth_token';
const AUTH_USER_KEY = 'aeris_auth_user';
const AUTH_EXPIRES_KEY = 'aeris_auth_expires_at';

function makeAuthResponse(overrides: Partial<AuthResponse> = {}): AuthResponse {
  return {
    access_token: 'NEW_TOKEN',
    token_type: 'Bearer',
    expires_at: '2099-01-01T00:00:00Z',
    user: {
      id: 1,
      name: 'Test',
      email: 't@example.com',
      role: 'cashier',
      location_id: null,
    },
    ...overrides,
  };
}

function resetAuthStore() {
  useAuthStore.setState({
    user: null,
    token: 'OLD_TOKEN',
    expiresAt: '2026-05-06T00:00:00Z',
    isAuthenticated: true,
    isLoading: false,
    error: null,
    errorKind: null,
    refreshInFlight: null,
  });
}

function setKeepSignedIn(value: boolean) {
  const current = useSettingsStore.getState().settings;
  useSettingsStore.setState({settings: {...current, keepSignedIn: value}});
}

describe('refreshSession', () => {
  let refreshSpy: jest.SpyInstance;

  beforeEach(() => {
    resetAuthStore();
    // Default opt-in matches the "Keep me signed in" default. Per-test
    // overrides flip this where needed.
    setKeepSignedIn(true);
    // Pre-seed the in-memory token so we can observe ApiClient.setAuthToken
    // overwrite it.
    ApiClient.setAuthToken('OLD_TOKEN');
  });

  afterEach(() => {
    if (refreshSpy) refreshSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('persists new token + user + expires_at and updates state on success', async () => {
    const response = makeAuthResponse();
    refreshSpy = jest
      .spyOn(ApiClient, 'refreshToken')
      .mockResolvedValueOnce(response);

    await useAuthStore.getState().refreshSession();

    const state = useAuthStore.getState();
    expect(state.token).toBe('NEW_TOKEN');
    expect(state.expiresAt).toBe('2099-01-01T00:00:00Z');
    expect(state.errorKind).toBeNull();
    expect(state.refreshInFlight).toBeNull();
    expect(await SecureStorage.getItem(AUTH_TOKEN_KEY)).toBe('NEW_TOKEN');
    expect(await SecureStorage.getItem(AUTH_EXPIRES_KEY)).toBe(
      '2099-01-01T00:00:00Z',
    );
    expect(await SecureStorage.getItem(AUTH_USER_KEY)).toContain(
      't@example.com',
    );
  });

  it('clears local session with errorKind=expired on a 401 / RelayError auth-rejection', async () => {
    const err = new RelayError(
      'Unauthenticated',
      'UNAUTHENTICATED',
      'cid-1',
      'auth.refresh',
    );
    refreshSpy = jest
      .spyOn(ApiClient, 'refreshToken')
      .mockRejectedValueOnce(err);
    // Silence warn from refreshSession (only logs on non-auth errors though).
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await useAuthStore.getState().refreshSession();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(state.errorKind).toBe('expired');
    expect(state.refreshInFlight).toBeNull();
  });

  it('also clears on a plain HTTP 401 error', async () => {
    const err = Object.assign(new Error('Authentication expired'), {
      status: 401,
    });
    refreshSpy = jest
      .spyOn(ApiClient, 'refreshToken')
      .mockRejectedValueOnce(err);
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await useAuthStore.getState().refreshSession();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.errorKind).toBe('expired');
  });

  it('shares an in-flight promise across concurrent callers', async () => {
    let resolveRefresh: (value: AuthResponse) => void = () => {};
    const pending = new Promise<AuthResponse>(resolve => {
      resolveRefresh = resolve;
    });
    refreshSpy = jest
      .spyOn(ApiClient, 'refreshToken')
      .mockReturnValueOnce(pending);

    const a = useAuthStore.getState().refreshSession();
    const b = useAuthStore.getState().refreshSession();
    // refreshInFlight should be set after the first call.
    expect(useAuthStore.getState().refreshInFlight).not.toBeNull();

    resolveRefresh(makeAuthResponse({access_token: 'CONCURRENT_TOKEN'}));
    await Promise.all([a, b]);

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().token).toBe('CONCURRENT_TOKEN');
    expect(useAuthStore.getState().refreshInFlight).toBeNull();
  });

  it('persists the new token to SecureStorage when keepSignedIn is true', async () => {
    setKeepSignedIn(true);
    const response = makeAuthResponse({access_token: 'KEEP_ON_TOKEN'});
    refreshSpy = jest
      .spyOn(ApiClient, 'refreshToken')
      .mockResolvedValueOnce(response);
    const setItemSpy = jest.spyOn(SecureStorage, 'setItem');

    await useAuthStore.getState().refreshSession();

    // SecureStorage.setItem was called with the new token under AUTH_TOKEN_KEY.
    const tokenCalls = setItemSpy.mock.calls.filter(
      ([key]) => key === AUTH_TOKEN_KEY,
    );
    expect(tokenCalls.length).toBeGreaterThan(0);
    expect(tokenCalls[tokenCalls.length - 1][1]).toBe('KEEP_ON_TOKEN');
    // In-memory state advanced too.
    expect(useAuthStore.getState().token).toBe('KEEP_ON_TOKEN');
    // And the Keychain readback confirms the persisted value.
    expect(await SecureStorage.getItem(AUTH_TOKEN_KEY)).toBe('KEEP_ON_TOKEN');
  });

  it('does NOT persist to SecureStorage when keepSignedIn is false but still updates in-memory state', async () => {
    setKeepSignedIn(false);
    // Seed the Keychain with a stale token from an earlier opted-in window;
    // the refresh path is also responsible for scrubbing that.
    await SecureStorage.setItem(AUTH_TOKEN_KEY, 'STALE_PERSISTED_TOKEN');
    await SecureStorage.setItem(AUTH_USER_KEY, '{"id":1,"email":"t@e.com"}');
    await SecureStorage.setItem(AUTH_EXPIRES_KEY, '2098-01-01T00:00:00Z');

    const response = makeAuthResponse({access_token: 'OPTED_OUT_TOKEN'});
    refreshSpy = jest
      .spyOn(ApiClient, 'refreshToken')
      .mockResolvedValueOnce(response);
    const setItemSpy = jest.spyOn(SecureStorage, 'setItem');

    await useAuthStore.getState().refreshSession();

    // The token must NEVER be written under AUTH_TOKEN_KEY when opted out.
    const tokenWrites = setItemSpy.mock.calls.filter(
      ([key]) => key === AUTH_TOKEN_KEY,
    );
    expect(tokenWrites).toHaveLength(0);
    // Same for user + expires — opt-out means nothing persisted.
    const userWrites = setItemSpy.mock.calls.filter(
      ([key]) => key === AUTH_USER_KEY,
    );
    expect(userWrites).toHaveLength(0);
    const expiresWrites = setItemSpy.mock.calls.filter(
      ([key]) => key === AUTH_EXPIRES_KEY,
    );
    expect(expiresWrites).toHaveLength(0);
    // In-memory state DID advance — the user stays authenticated for this
    // app launch; opt-out only affects cold-start restoration.
    expect(useAuthStore.getState().token).toBe('OPTED_OUT_TOKEN');
    expect(useAuthStore.getState().expiresAt).toBe('2099-01-01T00:00:00Z');
    // Stale persisted creds from the prior opted-in window get scrubbed so
    // a future cold start can't resurrect a dead session.
    expect(await SecureStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(await SecureStorage.getItem(AUTH_USER_KEY)).toBeNull();
    expect(await SecureStorage.getItem(AUTH_EXPIRES_KEY)).toBeNull();
  });

  it('does not clear session on transport / network errors and resets refreshInFlight', async () => {
    // No status property on the error → treated as transport failure.
    const err = new Error('Network request failed');
    refreshSpy = jest
      .spyOn(ApiClient, 'refreshToken')
      .mockRejectedValueOnce(err);
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(useAuthStore.getState().refreshSession()).rejects.toThrow(
      'Network request failed',
    );

    const state = useAuthStore.getState();
    // Session is still alive — the original 401 path will handle eventual
    // wipe if/when the next user-traffic call gets rejected.
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe('OLD_TOKEN');
    expect(state.errorKind).toBeNull();
    expect(state.refreshInFlight).toBeNull();
  });
});
