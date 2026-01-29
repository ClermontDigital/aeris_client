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

  test('should encrypt and decrypt a PIN correctly', () => {
    const pin = '1234';
    const encrypted = EncryptionService.encryptPin(pin);
    expect(encrypted).toHaveProperty('encrypted');
    expect(encrypted).toHaveProperty('iv');
    expect(encrypted).toHaveProperty('authTag');

    const decrypted = EncryptionService.decryptPin(encrypted);
    expect(decrypted).toBe(pin);
  });

  test('should produce different ciphertexts for same PIN (random IV)', () => {
    const e1 = EncryptionService.encryptPin('1234');
    const e2 = EncryptionService.encryptPin('1234');
    expect(e1.iv).not.toBe(e2.iv);
  });

  test('should return null for tampered data', () => {
    const encrypted = EncryptionService.encryptPin('5678');
    encrypted.authTag = 'ffffffff';
    expect(EncryptionService.decryptPin(encrypted)).toBeNull();
  });
});
