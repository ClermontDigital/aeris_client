const mockSecureStore: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStore[key] = value;
    return Promise.resolve();
  }),
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureStore[key] || null)),
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
    setItem: jest.fn((key: string, value: string) => {
      mockAsyncStorage[key] = value;
      return Promise.resolve();
    }),
    getItem: jest.fn((key: string) => Promise.resolve(mockAsyncStorage[key] || null)),
    removeItem: jest.fn((key: string) => {
      delete mockAsyncStorage[key];
      return Promise.resolve();
    }),
    multiRemove: jest.fn((keys: string[]) => {
      keys.forEach(k => delete mockAsyncStorage[k]);
      return Promise.resolve();
    }),
  },
}));

import {useSettingsStore} from '../settingsStore';
import {DEFAULT_CONFIG, STORAGE_KEYS} from '../../constants/config';
import {BulkStorage} from '../../services/StorageService';

function resetStore() {
  // Match the in-create initial state so each test starts from defaults.
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
}

describe('settingsStore stale-shape resilience', () => {
  beforeEach(() => {
    Object.keys(mockSecureStore).forEach(k => delete mockSecureStore[k]);
    Object.keys(mockAsyncStorage).forEach(k => delete mockAsyncStorage[k]);
    resetStore();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('a) per-field coercion: null baseUrl falls back to default, bad connectionMode falls back, valid fields survive', async () => {
    await BulkStorage.setItem(STORAGE_KEYS.SETTINGS, {
      baseUrl: null,
      relayUrl: 'http://x',
      connectionMode: 'auto', // not a valid ConnectionMode
      workspaceCode: 'ws',
    });

    await useSettingsStore.getState().init();

    const s = useSettingsStore.getState().settings;
    expect(s.baseUrl).toBe(DEFAULT_CONFIG.baseUrl);
    expect(s.relayUrl).toBe('http://x');
    expect(s.connectionMode).toBe(DEFAULT_CONFIG.connectionMode);
    expect(s.workspaceCode).toBe('ws');
    expect(useSettingsStore.getState().isLoading).toBe(false);
  });

  test('b) stored payload is a string ("not-an-object") → state ends with all defaults', async () => {
    await BulkStorage.setItem(STORAGE_KEYS.SETTINGS, 'not-an-object');

    await expect(useSettingsStore.getState().init()).resolves.toBeUndefined();

    const s = useSettingsStore.getState().settings;
    expect(s.baseUrl).toBe(DEFAULT_CONFIG.baseUrl);
    expect(s.relayUrl).toBe(DEFAULT_CONFIG.relayUrl);
    expect(s.connectionMode).toBe(DEFAULT_CONFIG.connectionMode);
    expect(s.workspaceCode).toBe(DEFAULT_CONFIG.workspaceCode);
    expect(s.sessionTimeout).toBe(DEFAULT_CONFIG.sessionTimeout);
    expect(s.enableSessionManagement).toBe(DEFAULT_CONFIG.enableSessionManagement);
  });

  test('c) stored is null → state remains at defaults, no throw', async () => {
    // Nothing seeded; BulkStorage.getItem returns null.
    await expect(useSettingsStore.getState().init()).resolves.toBeUndefined();

    const s = useSettingsStore.getState().settings;
    expect(s.baseUrl).toBe(DEFAULT_CONFIG.baseUrl);
    expect(s.relayUrl).toBe(DEFAULT_CONFIG.relayUrl);
    expect(s.connectionMode).toBe(DEFAULT_CONFIG.connectionMode);
    expect(s.workspaceCode).toBe(DEFAULT_CONFIG.workspaceCode);
  });

  test('d) per-field coercion: wrong types on number/boolean fields fall back to defaults', async () => {
    // sessionTimeout as a string + hapticsEnabled as a number are exactly
    // the kinds of values an old typescript-less build could have written.
    // pickNumber/pickBoolean must reject them rather than letting the
    // wrong type leak into downstream consumers.
    await BulkStorage.setItem(STORAGE_KEYS.SETTINGS, {
      baseUrl: 'http://valid:8080',
      relayUrl: 'http://relay:8080',
      sessionTimeout: '30', // string instead of number
      enableSessionManagement: 'yes', // string instead of boolean
      hapticsEnabled: 1, // number instead of boolean
      workspaceCode: 'ws',
    });

    await useSettingsStore.getState().init();

    const s = useSettingsStore.getState().settings;
    expect(s.sessionTimeout).toBe(DEFAULT_CONFIG.sessionTimeout);
    expect(s.enableSessionManagement).toBe(
      DEFAULT_CONFIG.enableSessionManagement,
    );
    expect(s.hapticsEnabled).toBe(DEFAULT_CONFIG.hapticsEnabled);
    expect(s.baseUrl).toBe('http://valid:8080');
    expect(s.workspaceCode).toBe('ws');
  });
});
