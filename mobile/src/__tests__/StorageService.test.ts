import StorageService from '../services/StorageService';

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

describe('StorageService', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
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
    await StorageService.setItem('a', 1);
    await StorageService.setItem('b', 2);
    await StorageService.clear();
    expect(await StorageService.getItem('a')).toBeNull();
    expect(await StorageService.getItem('b')).toBeNull();
  });
});
