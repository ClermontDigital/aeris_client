import ApiClient, {RelayError} from '../services/ApiClient';
import {useAuthStore} from '../stores/authStore';
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

describe('refreshSession', () => {
  let refreshSpy: jest.SpyInstance;

  beforeEach(() => {
    resetAuthStore();
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
