import {useAuthStore} from '../authStore';
import {useAppLockStore} from '../appLockStore';
import ApiClient from '../../services/ApiClient';

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
