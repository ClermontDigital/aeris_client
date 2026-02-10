import EncryptionService from '../services/EncryptionService';

// Mock EncryptedStorage
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

describe('EncryptionService', () => {
  beforeEach(async () => {
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    await EncryptionService.init();
  });

  test('should initialize and generate a persistent key', async () => {
    expect(mockStorage['aeris_encryption_key']).toBeDefined();
    expect(mockStorage['aeris_encryption_key'].length).toBe(64);
  });

  test('should reuse existing key on re-init', async () => {
    const firstKey = mockStorage['aeris_encryption_key'];
    await EncryptionService.init();
    expect(mockStorage['aeris_encryption_key']).toBe(firstKey);
  });

  test('should hash a PIN and verify it correctly', () => {
    const pin = '1234';
    const hashed = EncryptionService.hashPin(pin);
    expect(hashed).toHaveProperty('hash');
    expect(hashed).toHaveProperty('salt');

    expect(EncryptionService.verifyPin(pin, hashed)).toBe(true);
  });

  test('should reject wrong PIN', () => {
    const hashed = EncryptionService.hashPin('1234');
    expect(EncryptionService.verifyPin('0000', hashed)).toBe(false);
  });

  test('should produce different hashes for same PIN (random salt)', () => {
    const h1 = EncryptionService.hashPin('1234');
    const h2 = EncryptionService.hashPin('1234');
    expect(h1.salt).not.toBe(h2.salt);
    expect(h1.hash).not.toBe(h2.hash);
  });

  test('should reject verification with tampered hash', () => {
    const hashed = EncryptionService.hashPin('5678');
    hashed.hash = 'ff'.repeat(32);
    expect(EncryptionService.verifyPin('5678', hashed)).toBe(false);
  });
});
