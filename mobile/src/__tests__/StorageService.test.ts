import StorageService from '../services/StorageService';

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

describe('StorageService', () => {
  beforeEach(() => {
    Object.keys(mockSecureStore).forEach(k => delete mockSecureStore[k]);
    Object.keys(mockAsyncStorage).forEach(k => delete mockAsyncStorage[k]);
  });

  test('should set and get an item', async () => {
    await StorageService.setItem('test', {foo: 'bar'});
    const result = await StorageService.getItem<{foo: string}>('test');
    expect(result).toEqual({foo: 'bar'});
  });

  test('should return null for missing key', async () => {
    const result = await StorageService.getItem('nonexistent');
    expect(result).toBeNull();
  });

  test('should remove an item', async () => {
    await StorageService.setItem('test', 123);
    await StorageService.removeItem('test');
    const result = await StorageService.getItem('test');
    expect(result).toBeNull();
  });

  test('should clear all items', async () => {
    await StorageService.setItem('aeris_settings', {baseUrl: 'http://test'});
    await StorageService.setItem('aeris_sessions', [{id: '1'}]);
    await StorageService.clear();
    expect(await StorageService.getItem('aeris_settings')).toBeNull();
    expect(await StorageService.getItem('aeris_sessions')).toBeNull();
  });
});
