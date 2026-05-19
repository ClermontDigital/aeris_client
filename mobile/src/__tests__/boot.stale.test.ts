// Integration test: the whole boot path with stale storage payloads.
//
// Locks in the regression that "log in after weeks idle" must NOT crash
// the ErrorBoundary with "undefined is not a function". We pre-seed every
// piece of persisted storage the App.tsx boot useEffect reads, drive
// initSettings → restoreSession → restoreCache → initAppLock end-to-end,
// and assert no rejected promise + a usable end state.
//
// The companion per-store tests cover individual call sites; this test
// guards against subtle cross-store interaction (e.g. a settingsStore
// fallback that lets a bad baseUrl through to authStore's first fetch).

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import {useSettingsStore} from '../stores/settingsStore';
import {useAuthStore} from '../stores/authStore';
import {useProductCacheStore} from '../stores/productCacheStore';
import {useAppLockStore} from '../stores/appLockStore';
import AppLockService from '../services/AppLockService';
import {DEFAULT_CONFIG} from '../constants/config';

const AUTH_TOKEN_KEY = 'aeris_auth_token';
const AUTH_USER_KEY = 'aeris_auth_user';
const AUTH_EXPIRES_KEY = 'aeris_auth_expires_at';
const PIN_HASH_KEY = 'aeris_app_lock_pin';

async function clearAllStorage() {
  // The jest.setup mocks share their backing object across every test
  // module that touches them; drain both stores so prior tests can't
  // leak seeds into this one's setup phase.
  await AsyncStorage.clear?.();
  for (const key of [
    'aeris_settings',
    'aeris_product_cache',
    'aeris_category_cache',
    'aeris_cache_timestamp',
    'aeris_product_cache_version',
  ]) {
    await AsyncStorage.removeItem(key);
  }
  for (const key of [
    AUTH_TOKEN_KEY,
    AUTH_USER_KEY,
    AUTH_EXPIRES_KEY,
    PIN_HASH_KEY,
    'aeris_app_lock_biometric',
    'aeris_encryption_key',
  ]) {
    await SecureStore.deleteItemAsync(key);
  }
}

function resetZustandStores() {
  useSettingsStore.setState({
    settings: {
      baseUrl: DEFAULT_CONFIG.baseUrl,
      sessionTimeout: DEFAULT_CONFIG.sessionTimeout,
      enableSessionManagement: DEFAULT_CONFIG.enableSessionManagement,
      relayUrl: DEFAULT_CONFIG.relayUrl,
      connectionMode: DEFAULT_CONFIG.connectionMode,
      workspaceCode: DEFAULT_CONFIG.workspaceCode,
    },
    isLoading: true,
  });
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
  useProductCacheStore.setState({
    products: [],
    categories: [],
    lastSynced: null,
    isSyncing: false,
    lastSyncError: null,
  });
  useAppLockStore.setState({
    initialized: false,
    isLocked: false,
    hasPin: false,
    biometricEnabled: false,
    biometricAvailable: false,
    failedAttempts: 0,
  });
}

describe('boot path with stale persisted storage', () => {
  beforeEach(async () => {
    await clearAllStorage();
    resetZustandStores();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('boot completes without throwing when every persisted blob is malformed', async () => {
    // Seed each storage location with a different flavour of stale shape.
    // BulkStorage falls through to plain JSON.parse when no encryption key
    // is present, so writing raw strings into AsyncStorage works.
    await AsyncStorage.setItem(
      'aeris_settings',
      JSON.stringify({baseUrl: null, connectionMode: 'auto', workspaceCode: 42}),
    );
    await AsyncStorage.setItem(
      'aeris_product_cache',
      JSON.stringify([{id: 1}, {id: 2, name: null}]),
    );
    await AsyncStorage.setItem('aeris_category_cache', JSON.stringify([{id: 1}]));
    // Intentionally omit the version key so the cache is treated as v0.
    await SecureStore.setItemAsync(AUTH_TOKEN_KEY, 'stale-but-valid-shape-token');
    await SecureStore.setItemAsync(AUTH_USER_KEY, 'not-valid-json');
    await SecureStore.setItemAsync(
      PIN_HASH_KEY,
      JSON.stringify('legacy-bare-hash-string'),
    );

    // Drive the boot sequence exactly as mobile/src/App.tsx does — sequential,
    // each await before the next.
    await expect(useSettingsStore.getState().init()).resolves.not.toThrow();
    await expect(useAuthStore.getState().restoreSession()).resolves.not.toThrow();
    await expect(
      useProductCacheStore.getState().restoreCache(),
    ).resolves.not.toThrow();
    await expect(useAppLockStore.getState().init()).resolves.not.toThrow();

    // End state must be SAFE: settings fell back to defaults, no auth,
    // empty product cache, lock initialised + no PIN registered (the stale
    // PIN was wiped on verify but hasPin only flips false after a verify
    // attempt — confirm hasPin's read at init treats the bare-string entry
    // as "present" yet a subsequent verify drops it).
    expect(useSettingsStore.getState().settings.baseUrl).toBe(DEFAULT_CONFIG.baseUrl);
    expect(useSettingsStore.getState().settings.connectionMode).toBe(
      DEFAULT_CONFIG.connectionMode,
    );
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useProductCacheStore.getState().products).toEqual([]);
    expect(useAppLockStore.getState().initialized).toBe(true);
  });

  test('AppLock.verifyPin against a stale bare-hash PIN payload resolves to false', async () => {
    await SecureStore.setItemAsync(
      PIN_HASH_KEY,
      JSON.stringify('legacy-bare-hash-string'),
    );
    await useAppLockStore.getState().init();
    // init reads `hasPin` as true (payload is present); confirm that's the
    // starting point so the post-wipe assertion is meaningful.
    expect(useAppLockStore.getState().hasPin).toBe(true);

    // Drive verifyPin through the store (not the service) so the
    // lock-screen-dead-end follow-up is exercised end-to-end.
    await expect(useAppLockStore.getState().verifyPin('1234')).resolves.toBe(false);

    // And the stale entry was cleared so the next attempt routes to PIN
    // setup rather than re-tripping the same branch every unlock.
    expect(await SecureStore.getItemAsync(PIN_HASH_KEY)).toBeNull();
    // CRITICAL: hasPin in the store must have flipped to false. Without
    // this, the user is stuck on AppLockScreen typing their real PIN and
    // getting "wrong" five times in a row until forced logout.
    expect(useAppLockStore.getState().hasPin).toBe(false);
    expect(useAppLockStore.getState().isLocked).toBe(false);
  });

  test('AppLock.verifyPin against a stale {hash} payload missing salt resolves to false', async () => {
    await SecureStore.setItemAsync(
      PIN_HASH_KEY,
      JSON.stringify({hash: 'somehex'}),
    );
    await useAppLockStore.getState().init();

    await expect(AppLockService.verifyPin('1234')).resolves.toBe(false);
    expect(await SecureStore.getItemAsync(PIN_HASH_KEY)).toBeNull();
  });

  test('productCache restore + searchLocal survives stale entries with missing fields', async () => {
    await AsyncStorage.setItem(
      'aeris_product_cache',
      JSON.stringify([{id: 1, name: null, sku: null}]),
    );
    await AsyncStorage.setItem('aeris_category_cache', JSON.stringify([]));

    await expect(
      useProductCacheStore.getState().restoreCache(),
    ).resolves.not.toThrow();

    // The store's defensive nullish-coalesce in searchLocal must not throw
    // even if a poison entry slipped past restoreCache's filter.
    expect(() =>
      useProductCacheStore.getState().searchLocal('anything'),
    ).not.toThrow();
  });
});
