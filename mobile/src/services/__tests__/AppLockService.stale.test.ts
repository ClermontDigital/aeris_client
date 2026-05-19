import AppLockService from '../AppLockService';
import {SecureStorage} from '../StorageService';

const PIN_HASH_KEY = 'aeris_app_lock_pin';

describe('AppLockService.verifyPin stale-payload defence', () => {
  beforeEach(async () => {
    await SecureStorage.removeItem(PIN_HASH_KEY);
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns false (no throw) and clears storage when payload is a bare hash string', async () => {
    // Legacy persisted shape from a prior build: just the hash, no wrapper.
    await SecureStorage.setItem(PIN_HASH_KEY, JSON.stringify('legacyhashstring'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await AppLockService.verifyPin('1234');

    expect(result).toBe(false);
    expect(await SecureStorage.getItem(PIN_HASH_KEY)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns false (no throw) and clears storage when payload has hash but no salt', async () => {
    await SecureStorage.setItem(PIN_HASH_KEY, JSON.stringify({hash: 'x'}));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await AppLockService.verifyPin('1234');

    expect(result).toBe(false);
    expect(await SecureStorage.getItem(PIN_HASH_KEY)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns false (no throw) and clears storage when payload is not JSON at all', async () => {
    await SecureStorage.setItem(PIN_HASH_KEY, 'not-json-at-all');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await AppLockService.verifyPin('1234');

    expect(result).toBe(false);
    expect(await SecureStorage.getItem(PIN_HASH_KEY)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns false and clears storage when hash is a number instead of string', async () => {
    // Exercises the isStoredPin guard's string-type check on a non-string hash.
    await SecureStorage.setItem(PIN_HASH_KEY, JSON.stringify({hash: 42, salt: 'x'}));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await AppLockService.verifyPin('1234');

    expect(result).toBe(false);
    expect(await SecureStorage.getItem(PIN_HASH_KEY)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('returns false and clears storage when hash + salt are empty strings', async () => {
    // Empty strings pass typeof checks but would silently mismatch forever
    // without the non-empty guard; verify the wipe still happens.
    await SecureStorage.setItem(PIN_HASH_KEY, JSON.stringify({hash: '', salt: ''}));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await AppLockService.verifyPin('1234');

    expect(result).toBe(false);
    expect(await SecureStorage.getItem(PIN_HASH_KEY)).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });
});
