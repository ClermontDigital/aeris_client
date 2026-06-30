import { safeStorage } from 'electron';
import StoreMock from 'electron-store';
import { silentReauthStore } from '../silentReauthStore';

// M3-C credential cache — the security-critical invariants:
//   - NOTHING cached when the flag is OFF (default build holds zero creds).
//   - per-workspace scope (a cred for A is never returned for B).
//   - wipe on explicit clear / malformed / mismatch.
//   - FAIL-CLOSED when OS encryption is unavailable (never plaintext password).
// Source of truth: docs/PROJECT_DR_M3_BUILD_PLAN.md §M3-C, §3 guardrails.

describe('silentReauthStore', () => {
  beforeEach(() => {
    (StoreMock as unknown as { __resetAll: () => void }).__resetAll();
    silentReauthStore._resetCache();
    (safeStorage.isEncryptionAvailable as jest.Mock).mockReturnValue(true);
    jest.clearAllMocks();
  });

  test('FLAG OFF: save() is a hard no-op — nothing is cached', async () => {
    await silentReauthStore.save(false, 'shop-a', 'cashier@x.com', 'pw');
    // load() with flag off also returns null (and wipes)
    expect(await silentReauthStore.load(false, 'shop-a')).toBeNull();
    // even loading WITH the flag on finds nothing (it was never written)
    expect(await silentReauthStore.load(true, 'shop-a')).toBeNull();
  });

  test('FLAG ON: caches + returns the credential for the same workspace', async () => {
    await silentReauthStore.save(true, 'Shop-A', 'cashier@x.com', 'pw');
    const cred = await silentReauthStore.load(true, 'shop-a'); // case-insensitive
    expect(cred).toEqual({
      workspaceCode: 'shop-a',
      email: 'cashier@x.com',
      password: 'pw',
    });
  });

  test('per-workspace scope: a cred for shop-a is NOT returned for shop-b (and is wiped)', async () => {
    await silentReauthStore.save(true, 'shop-a', 'cashier@x.com', 'pw');
    expect(await silentReauthStore.load(true, 'shop-b')).toBeNull();
    // wiped on mismatch — a subsequent load for the right workspace is also null
    expect(await silentReauthStore.load(true, 'shop-a')).toBeNull();
  });

  test('load() with the flag OFF proactively wipes any cached cred', async () => {
    await silentReauthStore.save(true, 'shop-a', 'cashier@x.com', 'pw');
    expect(await silentReauthStore.load(false, 'shop-a')).toBeNull();
    // wiped — even turning the flag back on finds nothing
    expect(await silentReauthStore.load(true, 'shop-a')).toBeNull();
  });

  test('explicit clear() wipes', async () => {
    await silentReauthStore.save(true, 'shop-a', 'cashier@x.com', 'pw');
    await silentReauthStore.clear();
    expect(await silentReauthStore.load(true, 'shop-a')).toBeNull();
  });

  test('FAIL-CLOSED: no OS encryption -> save() writes nothing (no plaintext password)', async () => {
    (safeStorage.isEncryptionAvailable as jest.Mock).mockReturnValue(false);
    silentReauthStore._resetCache();
    await silentReauthStore.save(true, 'shop-a', 'cashier@x.com', 'pw');
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
    // re-enable encryption — still nothing cached
    (safeStorage.isEncryptionAvailable as jest.Mock).mockReturnValue(true);
    silentReauthStore._resetCache();
    expect(await silentReauthStore.load(true, 'shop-a')).toBeNull();
  });

  test('the password is passed to encryptString (encrypted at rest), never stored plaintext', async () => {
    await silentReauthStore.save(true, 'shop-a', 'cashier@x.com', 'sekret');
    expect(safeStorage.encryptString).toHaveBeenCalledTimes(1);
    const arg = (safeStorage.encryptString as jest.Mock).mock.calls[0][0] as string;
    expect(arg).toContain('sekret'); // the plaintext goes INTO encryptString...
    // ...and what lands in the store is the encrypted base64, not the password.
    const stored = (
      new StoreMock<{ cred: string | null }>({
        name: 'aeris-silent-reauth',
      }) as unknown as { get: (k: string) => unknown }
    ).get('cred') as string;
    expect(stored).not.toContain('sekret');
  });
});
