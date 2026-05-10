import { safeStorage } from 'electron';
import Store from 'electron-store';
import { AuthUserSnapshot } from '../shared-types/ipc';
import { logger } from './logger';

// Token + user persistence.
// - On macOS / Windows: bearer token is encrypted via Electron safeStorage
//   (Keychain / DPAPI) before being written to electron-store.
// - On Linux without a secret-service daemon (no GNOME Keyring / KWallet):
//   safeStorage.isEncryptionAvailable() returns false. We fall back to
//   plaintext storage with a one-time warning. Phase 3 will add a settings
//   toggle for "no-persist mode" so Linux-no-keyring users can opt out.

interface TokenStoreSchema {
  // Encrypted token bytes (base64) when safeStorage is available, else
  // the raw token string.
  token: string | null;
  user: AuthUserSnapshot | null;
  expiresAt: string | null;
  encryptionAvailable: boolean | null;
}

// Lazy — see settingsStore.ts for rationale (electron-store v10 needs
// app.getName() at construction time).
let _store: Store<TokenStoreSchema> | null = null;
function getStore(): Store<TokenStoreSchema> {
  if (!_store) {
    _store = new Store<TokenStoreSchema>({
      name: 'aeris-token',
      defaults: {
        token: null,
        user: null,
        expiresAt: null,
        encryptionAvailable: null,
      },
    });
  }
  return _store;
}

let cachedEncryptionAvailable: boolean | null = null;
let warnedLinuxFallback = false;

function isEncryptionAvailable(): boolean {
  if (cachedEncryptionAvailable !== null) return cachedEncryptionAvailable;
  try {
    cachedEncryptionAvailable = safeStorage.isEncryptionAvailable();
  } catch {
    cachedEncryptionAvailable = false;
  }
  if (!cachedEncryptionAvailable && !warnedLinuxFallback) {
    warnedLinuxFallback = true;
    logger.warn(
      '[tokenStore] safeStorage encryption unavailable on this platform — ' +
        'bearer token will be stored plaintext. ' +
        'Install a secret-service daemon (gnome-keyring / kwallet) to enable encryption.',
    );
  }
  return cachedEncryptionAvailable;
}

// Thrown when safeStorage.encryptString fails (corrupt keychain, missing
// secret-service daemon flipping mid-session, ...). authManager catches
// it and surfaces an 'unknown' errorKind so login doesn't silently
// "succeed" with a token we never persisted.
export class TokenEncryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenEncryptError';
  }
}

function encrypt(value: string): string {
  if (isEncryptionAvailable()) {
    try {
      return safeStorage.encryptString(value).toString('base64');
    } catch (e) {
      const message = (e as Error)?.message ?? String(e);
      logger.error('[tokenStore] safeStorage.encryptString failed', message);
      throw new TokenEncryptError(message);
    }
  }
  return value;
}

function decrypt(stored: string): string | null {
  // We don't persist a separate "is-encrypted" flag per record; we rely on
  // the cached encryption-available flag at read time. If a user moves the
  // electron-store DB between machines with/without a keyring, the worst
  // case is a corrupt-looking token which authManager will treat as a 401
  // and wipe.
  if (!isEncryptionAvailable()) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  } catch (e) {
    logger.warn('[tokenStore] failed to decrypt stored token; wiping', e);
    return null;
  }
}

const get = (key: keyof TokenStoreSchema) =>
  (getStore() as unknown as { get: (k: string) => unknown }).get(key as string);
const set = (key: keyof TokenStoreSchema, value: unknown) =>
  (getStore() as unknown as { set: (k: string, v: unknown) => void }).set(
    key as string,
    value,
  );

export const tokenStore = {
  isEncryptionAvailable,

  async getToken(): Promise<string | null> {
    const raw = get('token') as string | null;
    if (!raw) return null;
    return decrypt(raw);
  },

  async setToken(token: string): Promise<void> {
    set('token', encrypt(token));
  },

  async clearToken(): Promise<void> {
    set('token', null);
  },

  async getUser(): Promise<AuthUserSnapshot | null> {
    return (get('user') as AuthUserSnapshot | null) ?? null;
  },

  async setUser(user: AuthUserSnapshot | null): Promise<void> {
    set('user', user);
  },

  async getExpiresAt(): Promise<string | null> {
    return (get('expiresAt') as string | null) ?? null;
  },

  async setExpiresAt(iso: string | null): Promise<void> {
    set('expiresAt', iso);
  },

  async clearAll(): Promise<void> {
    set('token', null);
    set('user', null);
    set('expiresAt', null);
  },

  // Test-only reset of the cached encryption-available flag.
  _resetCache(): void {
    cachedEncryptionAvailable = null;
    warnedLinuxFallback = false;
  },
};
