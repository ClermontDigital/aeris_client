import { BrowserWindow, ipcMain, safeStorage } from 'electron';
import crypto from 'crypto';
import Store from 'electron-store';
import { IPC_CHANNELS, AppLockState } from '../shared-types/ipc';
import { logger } from './logger';
import { safeHandle } from './senderGuard';

// PIN-protected app lock. Hash is salted scrypt; the salt is stored
// alongside the hash. When safeStorage is available the {salt, hash}
// JSON blob is encrypted at rest, otherwise plaintext (Linux-no-keyring
// fallback already documented in tokenStore.ts).
//
// Lockout: 3 wrong attempts in a row -> 5-minute cooldown, persisted
// across restarts. Attempts counter resets on a correct entry.

const MAX_ATTEMPTS = 3;
const LOCKOUT_MS = 5 * 60 * 1000;
const SCRYPT_KEYLEN = 64;

interface PinRecord {
  salt: string;
  hash: string;
}

interface AppLockSchema {
  // safeStorage-encrypted JSON of {salt, hash}; null when no PIN set.
  pinRecord: string | null;
  attempts: number;
  lockedOutUntilMs: number | null;
  encryptionAvailable: boolean | null;
}

let _store: Store<AppLockSchema> | null = null;
function getStore(): Store<AppLockSchema> {
  if (!_store) {
    _store = new Store<AppLockSchema>({
      name: 'aeris-app-lock',
      defaults: {
        pinRecord: null,
        attempts: 0,
        lockedOutUntilMs: null,
        encryptionAvailable: null,
      },
    });
  }
  return _store;
}

const get = (k: keyof AppLockSchema) =>
  (getStore() as unknown as { get: (k: string) => unknown }).get(k as string);
const set = (k: keyof AppLockSchema, v: unknown) =>
  (getStore() as unknown as { set: (k: string, v: unknown) => void }).set(
    k as string,
    v,
  );

// Runtime state: locked/initialized live in memory, not on disk.
// The window auto-locks on blur/idle; lock state itself does not need
// to survive a process restart (a fresh launch already requires PIN
// when one is set).
let locked: boolean = false;
let initialized: boolean = false;

const subscribers = new Set<BrowserWindow>();

function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encryptRecord(record: PinRecord): string {
  const json = JSON.stringify(record);
  if (isEncryptionAvailable()) {
    return safeStorage.encryptString(json).toString('base64');
  }
  return json;
}

function decryptRecord(stored: string): PinRecord | null {
  try {
    const json = isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(stored, 'base64'))
      : stored;
    return JSON.parse(json) as PinRecord;
  } catch (e) {
    logger.warn('[appLockManager] failed to decode pin record', e);
    return null;
  }
}

// Async scrypt so a 50–150 ms hash doesn't pin the main thread (#H5).
// Concurrent relay:call from the renderer would otherwise stall during a
// PIN set/verify on lower-end machines.
function hashPin(pin: string, salt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pin, salt, SCRYPT_KEYLEN, (err, derived) => {
      if (err) reject(err);
      else resolve((derived as Buffer).toString('hex'));
    });
  });
}

function readPinRecord(): PinRecord | null {
  const stored = get('pinRecord') as string | null;
  if (!stored) return null;
  return decryptRecord(stored);
}

function isPinSet(): boolean {
  return readPinRecord() !== null;
}

function readAttempts(): number {
  return (get('attempts') as number | null) ?? 0;
}

function readLockoutUntil(): number | null {
  const v = get('lockedOutUntilMs') as number | null;
  if (v == null) return null;
  if (v <= Date.now()) {
    // Expired — clean up.
    set('lockedOutUntilMs', null);
    set('attempts', 0);
    return null;
  }
  return v;
}

export function getAppLockState(): AppLockState {
  return {
    initialized,
    isPinSet: isPinSet(),
    locked,
    attempts: readAttempts(),
    lockedOutUntilMs: readLockoutUntil(),
  };
}

export function registerAppLockWindow(win: BrowserWindow): void {
  subscribers.add(win);
  win.on('closed', () => subscribers.delete(win));
}

function emit(): void {
  const state = getAppLockState();
  for (const win of subscribers) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(IPC_CHANNELS.LOCK_STATE_CHANGED, state);
    } catch (e) {
      logger.warn('[appLockManager] failed to emit state', e);
    }
  }
}

export function initialize(): void {
  // Mark initialized + lock the app if a PIN is set so the renderer
  // shows AppLockScreen on launch.
  initialized = true;
  if (isPinSet()) {
    locked = true;
  }
  emit();
}

function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export async function setPin(
  pin: string,
): Promise<{ ok: boolean; message?: string }> {
  if (!isValidPin(pin)) {
    return { ok: false, message: 'PIN must be 4–6 digits.' };
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await hashPin(pin, salt);
  set('pinRecord', encryptRecord({ salt, hash }));
  set('attempts', 0);
  set('lockedOutUntilMs', null);
  // After setting, we are not locked — user is in a freshly-authenticated
  // session and just configured PIN.
  locked = false;
  emit();
  logger.info('[appLockManager] pin set');
  return { ok: true };
}

export async function verifyPin(pin: string): Promise<{
  ok: boolean;
  attemptsRemaining?: number;
  lockedOutUntilMs?: number | null;
}> {
  // Refuse during cooldown — checked before hashing so the lockout
  // cooldown gate stays cheap and unaffected by the async hash.
  const cooldownUntil = readLockoutUntil();
  if (cooldownUntil) {
    return { ok: false, attemptsRemaining: 0, lockedOutUntilMs: cooldownUntil };
  }
  const record = readPinRecord();
  if (!record) {
    return { ok: false, attemptsRemaining: 0 };
  }
  const candidate = await hashPin(pin, record.salt);
  if (candidate === record.hash) {
    set('attempts', 0);
    set('lockedOutUntilMs', null);
    locked = false;
    emit();
    return { ok: true };
  }
  // Wrong PIN.
  const next = readAttempts() + 1;
  set('attempts', next);
  let lockedOutUntilMs: number | null = null;
  if (next >= MAX_ATTEMPTS) {
    lockedOutUntilMs = Date.now() + LOCKOUT_MS;
    set('lockedOutUntilMs', lockedOutUntilMs);
    logger.warn('[appLockManager] lockout triggered');
  }
  emit();
  return {
    ok: false,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - next),
    lockedOutUntilMs,
  };
}

export function clearPin(): { ok: boolean } {
  set('pinRecord', null);
  set('attempts', 0);
  set('lockedOutUntilMs', null);
  locked = false;
  emit();
  logger.info('[appLockManager] pin cleared');
  return { ok: true };
}

export function lockNow(): void {
  if (!isPinSet()) return; // nothing to lock without a PIN
  if (locked) return;
  locked = true;
  emit();
  logger.info('[appLockManager] locked');
}

export function unlock(): void {
  if (!locked) return;
  locked = false;
  emit();
}

export function registerAppLockIpc(): void {
  safeHandle(IPC_CHANNELS.LOCK_GET_STATE, () => getAppLockState());
  safeHandle(IPC_CHANNELS.LOCK_SET_PIN, async (_e, pin) =>
    setPin(pin as string),
  );
  safeHandle(IPC_CHANNELS.LOCK_VERIFY_PIN, async (_e, pin) =>
    verifyPin(pin as string),
  );
  safeHandle(IPC_CHANNELS.LOCK_CLEAR_PIN, () => clearPin());
  safeHandle(IPC_CHANNELS.LOCK_NOW, () => {
    lockNow();
    return { ok: true };
  });
}

// Test-only resets.
export function _resetForTests(): void {
  locked = false;
  initialized = false;
  set('pinRecord', null);
  set('attempts', 0);
  set('lockedOutUntilMs', null);
}
