import EncryptionService from '../services/EncryptionService';

// Mock expo-secure-store
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

describe('EncryptionService', () => {
  beforeEach(async () => {
    Object.keys(mockSecureStore).forEach(k => delete mockSecureStore[k]);
    await EncryptionService.init();
  });

  test('should initialize and generate a persistent key', async () => {
    expect(mockSecureStore['aeris_encryption_key']).toBeDefined();
    expect(mockSecureStore['aeris_encryption_key'].length).toBe(64);
  });

  test('should reuse existing key on re-init', async () => {
    const firstKey = mockSecureStore['aeris_encryption_key'];
    await EncryptionService.init();
    expect(mockSecureStore['aeris_encryption_key']).toBe(firstKey);
  });

  test('should hash a PIN and verify it correctly', async () => {
    const pin = '1234';
    const hashed = await EncryptionService.hashPin(pin);
    expect(hashed).toHaveProperty('hash');
    expect(hashed).toHaveProperty('salt');

    expect(await EncryptionService.verifyPin(pin, hashed)).toBe(true);
  });

  test('should reject wrong PIN', async () => {
    const hashed = await EncryptionService.hashPin('1234');
    expect(await EncryptionService.verifyPin('0000', hashed)).toBe(false);
  });

  test('should produce different hashes for same PIN (random salt)', async () => {
    const h1 = await EncryptionService.hashPin('1234');
    const h2 = await EncryptionService.hashPin('1234');
    expect(h1.salt).not.toBe(h2.salt);
    expect(h1.hash).not.toBe(h2.hash);
  });

  test('should reject verification with tampered hash', async () => {
    const hashed = await EncryptionService.hashPin('5678');
    hashed.hash = 'ff'.repeat(32);
    expect(await EncryptionService.verifyPin('5678', hashed)).toBe(false);
  });
});
