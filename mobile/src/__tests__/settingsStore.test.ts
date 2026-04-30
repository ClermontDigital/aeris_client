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

import {useSettingsStore} from '../stores/settingsStore';

describe('settingsStore', () => {
  beforeEach(async () => {
    Object.keys(mockSecureStore).forEach(k => delete mockSecureStore[k]);
    Object.keys(mockAsyncStorage).forEach(k => delete mockAsyncStorage[k]);
    useSettingsStore.setState({
      settings: {baseUrl: 'http://aeris.local:8000', sessionTimeout: 30, enableSessionManagement: false, autoStart: false},
      isLoading: false,
    });
    await useSettingsStore.getState().init();
  });

  test('should initialize with defaults', () => {
    const state = useSettingsStore.getState();
    expect(state.settings.baseUrl).toBe('http://aeris.local:8000');
    expect(state.settings.sessionTimeout).toBe(30);
    expect(state.settings.enableSessionManagement).toBe(false);
    expect(state.isLoading).toBe(false);
  });

  test('should save and update settings', async () => {
    await useSettingsStore.getState().saveSettings({baseUrl: 'http://10.0.0.140:8000'});
    expect(useSettingsStore.getState().settings.baseUrl).toBe('http://10.0.0.140:8000');
    // Should persist
    expect(mockAsyncStorage['aeris_settings']).toContain('10.0.0.140');
  });

  test('should merge partial settings', async () => {
    await useSettingsStore.getState().saveSettings({sessionTimeout: 60});
    const s = useSettingsStore.getState().settings;
    expect(s.sessionTimeout).toBe(60);
    expect(s.baseUrl).toBe('http://aeris.local:8000'); // unchanged
  });

  test('testConnection should return false on network error', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('fail'))) as any;
    const result = await useSettingsStore.getState().testConnection('http://bad.local');
    expect(result).toBe(false);
  });

  test('testConnection should return true on success', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ok: true, status: 200})) as any;
    const result = await useSettingsStore.getState().testConnection();
    expect(result).toBe(true);
  });

  test('lowercases and trims workspaceCode on save', async () => {
    await useSettingsStore.getState().saveSettings({workspaceCode: '  ACME-Prod  '});
    expect(useSettingsStore.getState().settings.workspaceCode).toBe('acme-prod');
  });
});
