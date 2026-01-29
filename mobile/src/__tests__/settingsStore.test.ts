const mockStorage: Record<string, string> = {};

jest.mock('react-native-encrypted-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn((key: string, value: string) => {
      mockStorage[key] = value;
      return Promise.resolve();
    }),
    getItem: jest.fn((key: string) => Promise.resolve(mockStorage[key] || null)),
    removeItem: jest.fn((key: string) => {
      delete mockStorage[key];
      return Promise.resolve();
    }),
    clear: jest.fn(() => {
      Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
      return Promise.resolve();
    }),
  },
}));

import {useSettingsStore} from '../stores/settingsStore';

describe('settingsStore', () => {
  beforeEach(async () => {
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
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
    expect(mockStorage['aeris_settings']).toContain('10.0.0.140');
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
});
