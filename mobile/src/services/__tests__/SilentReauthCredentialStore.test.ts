// M3-C — secure silent-re-auth credential cache. Tests the SECURITY-critical
// invariants: flag-gated (no caching when off), per-workspace scope, wiped on
// clear. expo-secure-store is mocked the same way drStore.test does.
const mockSecureStore: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStore[key] = value;
    return Promise.resolve();
  }),
  getItemAsync: jest.fn((key: string) =>
    Promise.resolve(mockSecureStore[key] || null),
  ),
  deleteItemAsync: jest.fn((key: string) => {
    delete mockSecureStore[key];
    return Promise.resolve();
  }),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
}));

const mockAsyncStorage: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn(),
    getItem: jest.fn(() => Promise.resolve(null)),
    removeItem: jest.fn(),
    multiRemove: jest.fn(),
  },
}));

import {SilentReauthCredentialStore} from '../SilentReauthCredentialStore';

const CRED_KEY = 'aeris_silent_reauth_cred';

beforeEach(() => {
  Object.keys(mockSecureStore).forEach(k => delete mockSecureStore[k]);
});

describe('SilentReauthCredentialStore — flag gate', () => {
  it('does NOT cache when autoFailoverEnabled is OFF (default build)', async () => {
    await SilentReauthCredentialStore.save(false, 'shop-a', 'u@x.com', 'pw');
    expect(mockSecureStore[CRED_KEY]).toBeUndefined();
  });

  it('caches when the flag is ON', async () => {
    await SilentReauthCredentialStore.save(true, 'shop-a', 'u@x.com', 'pw');
    expect(mockSecureStore[CRED_KEY]).toBeDefined();
  });

  it('load returns null AND wipes when the flag is OFF', async () => {
    // Seed a credential (as if cached while flag was on), then flag flips off.
    await SilentReauthCredentialStore.save(true, 'shop-a', 'u@x.com', 'pw');
    expect(mockSecureStore[CRED_KEY]).toBeDefined();
    const got = await SilentReauthCredentialStore.load(false, 'shop-a');
    expect(got).toBeNull();
    // Proactively wiped so no secret lingers once the flag is off.
    expect(mockSecureStore[CRED_KEY]).toBeUndefined();
  });
});

describe('SilentReauthCredentialStore — per-workspace scope', () => {
  it('returns the credential for the SAME workspace (case/space-insensitive)', async () => {
    await SilentReauthCredentialStore.save(true, 'Shop-A', 'u@x.com', 'pw');
    const got = await SilentReauthCredentialStore.load(true, ' shop-a ');
    expect(got).not.toBeNull();
    expect(got?.email).toBe('u@x.com');
    expect(got?.password).toBe('pw');
  });

  it('refuses (and wipes) a credential cached for a DIFFERENT workspace', async () => {
    await SilentReauthCredentialStore.save(true, 'shop-a', 'u@x.com', 'pw');
    const got = await SilentReauthCredentialStore.load(true, 'shop-b');
    expect(got).toBeNull();
    expect(mockSecureStore[CRED_KEY]).toBeUndefined();
  });
});

describe('SilentReauthCredentialStore — wipe + robustness', () => {
  it('clear() wipes the cached credential', async () => {
    await SilentReauthCredentialStore.save(true, 'shop-a', 'u@x.com', 'pw');
    await SilentReauthCredentialStore.clear();
    expect(mockSecureStore[CRED_KEY]).toBeUndefined();
    expect(await SilentReauthCredentialStore.load(true, 'shop-a')).toBeNull();
  });

  it('load returns null + wipes a malformed blob', async () => {
    mockSecureStore[CRED_KEY] = '{not json';
    expect(await SilentReauthCredentialStore.load(true, 'shop-a')).toBeNull();
    expect(mockSecureStore[CRED_KEY]).toBeUndefined();
  });

  it('save is a no-op with no workspace code (nothing to scope against)', async () => {
    await SilentReauthCredentialStore.save(true, null, 'u@x.com', 'pw');
    expect(mockSecureStore[CRED_KEY]).toBeUndefined();
  });
});
