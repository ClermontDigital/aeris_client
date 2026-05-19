import ApiClient from '../../services/ApiClient';
import {useAuthStore} from '../authStore';
import {SecureStorage} from '../../services/StorageService';
import type {AuthResponse, User} from '../../types/api.types';

const AUTH_TOKEN_KEY = 'aeris_auth_token';
const AUTH_USER_KEY = 'aeris_auth_user';
const AUTH_EXPIRES_KEY = 'aeris_auth_expires_at';

describe('authStore.restoreSession stale-payload defence', () => {
  beforeEach(async () => {
    await SecureStorage.removeItem(AUTH_TOKEN_KEY);
    await SecureStorage.removeItem(AUTH_USER_KEY);
    await SecureStorage.removeItem(AUTH_EXPIRES_KEY);
    useAuthStore.setState({
      user: null,
      token: null,
      expiresAt: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,
      errorKind: null,
      refreshInFlight: null,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('clears auth keys and leaves the store unauthenticated when persisted user has wrong-typed name', async () => {
    await SecureStorage.setItem(AUTH_TOKEN_KEY, 'valid-token');
    await SecureStorage.setItem(
      AUTH_USER_KEY,
      JSON.stringify({id: 1, email: 'a@e.com', name: 42}),
    );
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(useAuthStore.getState().restoreSession()).resolves.toBeUndefined();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(await SecureStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(await SecureStorage.getItem(AUTH_USER_KEY)).toBeNull();
  });

  it('clears auth keys and leaves the store unauthenticated when persisted user is not valid JSON', async () => {
    await SecureStorage.setItem(AUTH_TOKEN_KEY, 'valid-token');
    await SecureStorage.setItem(AUTH_USER_KEY, 'not-valid-json');
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(useAuthStore.getState().restoreSession()).resolves.toBeUndefined();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
    expect(state.isLoading).toBe(false);
    expect(await SecureStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(await SecureStorage.getItem(AUTH_USER_KEY)).toBeNull();
  });
});

describe('authStore.login user-shape defence', () => {
  beforeEach(async () => {
    await SecureStorage.removeItem(AUTH_TOKEN_KEY);
    await SecureStorage.removeItem(AUTH_USER_KEY);
    await SecureStorage.removeItem(AUTH_EXPIRES_KEY);
    useAuthStore.setState({
      user: null,
      token: null,
      expiresAt: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      errorKind: null,
      refreshInFlight: null,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects login when the relay response is missing required user fields', async () => {
    // Relay deploys have historically shifted the user payload shape under
    // us. A response without `id` or `email` would otherwise be persisted
    // and crash the next render.
    jest.spyOn(ApiClient, 'login').mockResolvedValue({
      access_token: 'tok-xyz',
      token_type: 'Bearer',
      expires_at: '2099-01-01T00:00:00Z',
      // Intentionally malformed — no email. The double cast walks past the
      // type system because the runtime drift we're guarding against
      // doesn't honour the type at all.
      user: {id: 1},
    } as unknown as AuthResponse);

    await expect(
      useAuthStore.getState().login('a@e.com', 'pw'),
    ).rejects.toThrow(/user fields/i);

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(await SecureStorage.getItem(AUTH_TOKEN_KEY)).toBeNull();
    expect(await SecureStorage.getItem(AUTH_USER_KEY)).toBeNull();
  });

  it('rejects login when the relay response has a number for user.name', async () => {
    jest.spyOn(ApiClient, 'login').mockResolvedValue({
      access_token: 'tok-xyz',
      token_type: 'Bearer',
      expires_at: '2099-01-01T00:00:00Z',
      user: {id: 1, email: 'a@e.com', name: 42},
    } as unknown as AuthResponse);

    await expect(
      useAuthStore.getState().login('a@e.com', 'pw'),
    ).rejects.toThrow(/user fields/i);

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
  });
});

describe('authStore.refreshSession user-shape defence', () => {
  const VALID_USER: User = {
    id: 1,
    name: 'Test',
    email: 'a@e.com',
    role: 'cashier',
    location_id: null,
  };

  beforeEach(async () => {
    await SecureStorage.removeItem(AUTH_TOKEN_KEY);
    await SecureStorage.removeItem(AUTH_USER_KEY);
    await SecureStorage.removeItem(AUTH_EXPIRES_KEY);
    useAuthStore.setState({
      user: VALID_USER,
      token: 'OLD_TOKEN',
      expiresAt: '2026-05-06T00:00:00Z',
      isAuthenticated: true,
      isLoading: false,
      error: null,
      errorKind: null,
      refreshInFlight: null,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps the previous in-memory user when refresh returns a malformed user', async () => {
    jest.spyOn(ApiClient, 'refreshToken').mockResolvedValue({
      access_token: 'NEW_TOKEN',
      token_type: 'Bearer',
      expires_at: '2099-01-01T00:00:00Z',
      user: {id: 'not-a-number', email: 'a@e.com'},
    } as unknown as AuthResponse);

    await expect(useAuthStore.getState().refreshSession()).resolves.toBeUndefined();

    const state = useAuthStore.getState();
    // Token + expiry refreshed; the bad user was rejected and the prior
    // valid user stayed in place.
    expect(state.token).toBe('NEW_TOKEN');
    expect(state.user).toEqual(VALID_USER);
    // The malformed user must not have been persisted either.
    expect(await SecureStorage.getItem(AUTH_USER_KEY)).toBeNull();
  });

  it('accepts a valid user on refresh and updates state + storage', async () => {
    const FRESH_USER: User = {
      id: 2,
      name: 'Fresh',
      email: 'fresh@e.com',
      role: 'cashier',
      location_id: null,
    };
    jest.spyOn(ApiClient, 'refreshToken').mockResolvedValue({
      access_token: 'NEW_TOKEN',
      token_type: 'Bearer',
      expires_at: '2099-01-01T00:00:00Z',
      user: FRESH_USER,
    } as AuthResponse);

    await useAuthStore.getState().refreshSession();

    const state = useAuthStore.getState();
    expect(state.token).toBe('NEW_TOKEN');
    expect(state.user).toEqual(FRESH_USER);
    const stored = await SecureStorage.getItem(AUTH_USER_KEY);
    expect(stored ? JSON.parse(stored) : null).toEqual(FRESH_USER);
  });
});
