import { tokenStore } from '../tokenStore';
import { safeStorage } from 'electron';
import StoreMock from 'electron-store';

describe('tokenStore', () => {
  beforeEach(() => {
    (StoreMock as unknown as { __resetAll: () => void }).__resetAll();
    tokenStore._resetCache();
    (safeStorage.isEncryptionAvailable as jest.Mock).mockReset();
    (safeStorage.encryptString as jest.Mock).mockClear();
    (safeStorage.decryptString as jest.Mock).mockClear();
  });

  test('round-trips token via safeStorage when encryption is available', async () => {
    (safeStorage.isEncryptionAvailable as jest.Mock).mockReturnValue(true);
    (safeStorage.encryptString as jest.Mock).mockImplementation((s: string) =>
      Buffer.from('enc:' + s),
    );
    (safeStorage.decryptString as jest.Mock).mockImplementation((b: Buffer) =>
      b.toString('utf8').replace(/^enc:/, ''),
    );

    await tokenStore.setToken('secret-token');
    expect(safeStorage.encryptString).toHaveBeenCalledWith('secret-token');

    const got = await tokenStore.getToken();
    expect(got).toBe('secret-token');
  });

  test('falls back to plaintext when encryption unavailable', async () => {
    (safeStorage.isEncryptionAvailable as jest.Mock).mockReturnValue(false);
    await tokenStore.setToken('plain-token');
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
    const got = await tokenStore.getToken();
    expect(got).toBe('plain-token');
  });

  test('clearToken wipes the stored value', async () => {
    (safeStorage.isEncryptionAvailable as jest.Mock).mockReturnValue(true);
    (safeStorage.encryptString as jest.Mock).mockImplementation((s: string) =>
      Buffer.from('enc:' + s),
    );
    (safeStorage.decryptString as jest.Mock).mockImplementation((b: Buffer) =>
      b.toString('utf8').replace(/^enc:/, ''),
    );

    await tokenStore.setToken('x');
    await tokenStore.clearToken();
    expect(await tokenStore.getToken()).toBeNull();
  });

  test('user + expiresAt round-trip independently', async () => {
    (safeStorage.isEncryptionAvailable as jest.Mock).mockReturnValue(false);
    await tokenStore.setUser({ id: 7, email: 'me@aeris', name: 'Me' });
    await tokenStore.setExpiresAt('2030-01-01');
    expect(await tokenStore.getUser()).toEqual({
      id: 7,
      email: 'me@aeris',
      name: 'Me',
    });
    expect(await tokenStore.getExpiresAt()).toBe('2030-01-01');
  });
});
