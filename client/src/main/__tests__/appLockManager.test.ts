import StoreMock from 'electron-store';
import * as appLockManager from '../appLockManager';

describe('appLockManager', () => {
  beforeEach(() => {
    (StoreMock as unknown as { __resetAll: () => void }).__resetAll();
    appLockManager._resetForTests();
  });

  test('initial state has no PIN, not locked', () => {
    appLockManager.initialize();
    const s = appLockManager.getAppLockState();
    expect(s.isPinSet).toBe(false);
    expect(s.locked).toBe(false);
    expect(s.attempts).toBe(0);
    expect(s.initialized).toBe(true);
  });

  test('setPin rejects bad shapes', async () => {
    expect((await appLockManager.setPin('')).ok).toBe(false);
    expect((await appLockManager.setPin('123')).ok).toBe(false); // too short
    expect((await appLockManager.setPin('1234567')).ok).toBe(false); // too long
    expect((await appLockManager.setPin('12a4')).ok).toBe(false); // non-digits
  });

  test('setPin accepts 4-6 digit numeric', async () => {
    expect((await appLockManager.setPin('1234')).ok).toBe(true);
    expect((await appLockManager.setPin('123456')).ok).toBe(true);
  });

  test('verifyPin returns ok=true for the correct PIN and resets attempts', async () => {
    await appLockManager.setPin('1234');
    appLockManager.lockNow();
    expect(appLockManager.getAppLockState().locked).toBe(true);
    const result = await appLockManager.verifyPin('1234');
    expect(result.ok).toBe(true);
    expect(appLockManager.getAppLockState().locked).toBe(false);
    expect(appLockManager.getAppLockState().attempts).toBe(0);
  });

  test('verifyPin returns ok=false and increments attempts on wrong PIN', async () => {
    await appLockManager.setPin('1234');
    const a = await appLockManager.verifyPin('0000');
    expect(a.ok).toBe(false);
    expect(a.attemptsRemaining).toBe(2);
    const b = await appLockManager.verifyPin('0000');
    expect(b.attemptsRemaining).toBe(1);
  });

  test('3 wrong attempts triggers a lockout cooldown', async () => {
    await appLockManager.setPin('1234');
    await appLockManager.verifyPin('0000');
    await appLockManager.verifyPin('0000');
    const c = await appLockManager.verifyPin('0000');
    expect(c.ok).toBe(false);
    expect(c.lockedOutUntilMs).toBeGreaterThan(Date.now());
    // During cooldown, even the correct PIN is refused.
    const cooled = await appLockManager.verifyPin('1234');
    expect(cooled.ok).toBe(false);
    expect(cooled.lockedOutUntilMs).toBeGreaterThan(Date.now());
  });

  test('lockout cooldown persists across new module reads (electron-store)', async () => {
    await appLockManager.setPin('1234');
    await appLockManager.verifyPin('0000');
    await appLockManager.verifyPin('0000');
    await appLockManager.verifyPin('0000');
    const before = appLockManager.getAppLockState().lockedOutUntilMs;
    expect(before).toBeGreaterThan(Date.now());
    // Re-reading state goes through the store, simulating a process
    // restart well enough since the bucket is durable in the mock.
    const stateAgain = appLockManager.getAppLockState();
    expect(stateAgain.lockedOutUntilMs).toBe(before);
  });

  test('clearPin wipes the record, attempts, and lockout', async () => {
    await appLockManager.setPin('1234');
    await appLockManager.verifyPin('0000');
    appLockManager.clearPin();
    const s = appLockManager.getAppLockState();
    expect(s.isPinSet).toBe(false);
    expect(s.attempts).toBe(0);
    expect(s.lockedOutUntilMs).toBeNull();
  });

  test('lockNow is a noop when no PIN is set', () => {
    appLockManager.lockNow();
    expect(appLockManager.getAppLockState().locked).toBe(false);
  });

  test('lockNow flips locked=true when a PIN is set', async () => {
    await appLockManager.setPin('1234');
    expect(appLockManager.getAppLockState().locked).toBe(false);
    appLockManager.lockNow();
    expect(appLockManager.getAppLockState().locked).toBe(true);
  });

  test('initialize() locks the app when a PIN is already set', async () => {
    await appLockManager.setPin('1234');
    appLockManager._resetForTests();
    await appLockManager.setPin('1234');
    appLockManager.initialize();
    expect(appLockManager.getAppLockState().locked).toBe(true);
  });

  test('setPin and verifyPin return promises (async scrypt, #H5)', async () => {
    const setRet = appLockManager.setPin('1234');
    expect(typeof (setRet as Promise<unknown>).then).toBe('function');
    await setRet;
    const verifyRet = appLockManager.verifyPin('1234');
    expect(typeof (verifyRet as Promise<unknown>).then).toBe('function');
    await verifyRet;
  });

  test('verifyPin during cooldown short-circuits without delay (#H5 — gate stays cheap)', async () => {
    await appLockManager.setPin('1234');
    await appLockManager.verifyPin('0000');
    await appLockManager.verifyPin('0000');
    await appLockManager.verifyPin('0000');
    // Cooldown branch returns synchronously after the gate; even with the
    // async hashPin migration, the gate path should resolve almost
    // immediately. 50 ms is very generous compared with scrypt's ~50–150 ms.
    const start = Date.now();
    const cooled = await appLockManager.verifyPin('1234');
    const elapsed = Date.now() - start;
    expect(cooled.ok).toBe(false);
    expect(cooled.lockedOutUntilMs).toBeGreaterThan(Date.now());
    expect(elapsed).toBeLessThan(50);
  });
});
