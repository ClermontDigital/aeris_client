import { BrowserWindow, powerMonitor } from 'electron';
import StoreMock from 'electron-store';
import { attachAutoLock, detachAutoLockForTests } from '../autoLock';
import { settingsStore } from '../settingsStore';
import * as appLockManager from '../appLockManager';

// autoLock orchestrates blur-debounce + idle-poll into lockNow(). The
// scenarios below mock the Electron `powerMonitor` + BrowserWindow event
// hooks to drive the timers without waiting on real wall-clock time.

type BWInst = {
  on: jest.Mock;
  isDestroyed: jest.Mock;
  webContents: { send: jest.Mock };
  removeListener: jest.Mock;
};

function lastBwInstance(): BWInst {
  const insts = (BrowserWindow as unknown as { __instances: BWInst[] })
    .__instances;
  return insts[insts.length - 1];
}

function fireWindowEvent(name: string): void {
  const inst = lastBwInstance();
  // Find the most recent listener registered for `name` and invoke it.
  const calls = (inst.on as jest.Mock).mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    if (calls[i][0] === name) {
      (calls[i][1] as () => void)();
      return;
    }
  }
  throw new Error(`no listener for window event '${name}'`);
}

describe('autoLock', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (StoreMock as unknown as { __resetAll: () => void }).__resetAll();
    settingsStore._reset();
    appLockManager._resetForTests();
    (BrowserWindow as unknown as { __resetInstances: () => void })
      .__resetInstances();
    (powerMonitor.getSystemIdleTime as jest.Mock).mockReturnValue(0);
    detachAutoLockForTests();
  });

  afterEach(() => {
    detachAutoLockForTests();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('blur fires lockNow after the 30s debounce when PIN is set + lockEnabled', async () => {
    await appLockManager.setPin('1234');
    settingsStore.set({ lockEnabled: true });
    const lockSpy = jest.spyOn(appLockManager, 'lockNow');

    const win = new BrowserWindow();
    attachAutoLock(win);
    fireWindowEvent('blur');

    // Just before the debounce: still pending.
    jest.advanceTimersByTime(29_000);
    expect(lockSpy).not.toHaveBeenCalled();
    // Now cross the threshold.
    jest.advanceTimersByTime(2_000);
    expect(lockSpy).toHaveBeenCalled();
  });

  test('focus before debounce fires cancels the pending lock', async () => {
    await appLockManager.setPin('1234');
    const lockSpy = jest.spyOn(appLockManager, 'lockNow');

    const win = new BrowserWindow();
    attachAutoLock(win);
    fireWindowEvent('blur');
    jest.advanceTimersByTime(10_000);
    fireWindowEvent('focus');
    jest.advanceTimersByTime(60_000);
    expect(lockSpy).not.toHaveBeenCalled();
  });

  test('idle poll triggers lockNow once getSystemIdleTime exceeds autoLockMs', async () => {
    await appLockManager.setPin('1234');
    settingsStore.set({ lockEnabled: true, autoLockMs: 60_000 });
    const lockSpy = jest.spyOn(appLockManager, 'lockNow');

    const win = new BrowserWindow();
    attachAutoLock(win);

    // Before the 60s threshold, even when the poll fires.
    (powerMonitor.getSystemIdleTime as jest.Mock).mockReturnValue(30);
    jest.advanceTimersByTime(30_000);
    expect(lockSpy).not.toHaveBeenCalled();

    // After: poll sees idleSec * 1000 >= autoLockMs and locks.
    (powerMonitor.getSystemIdleTime as jest.Mock).mockReturnValue(120);
    jest.advanceTimersByTime(30_000);
    expect(lockSpy).toHaveBeenCalled();
  });

  test('blur is a noop while lockEnabled is false', async () => {
    await appLockManager.setPin('1234');
    settingsStore.set({ lockEnabled: false });
    const lockSpy = jest.spyOn(appLockManager, 'lockNow');

    const win = new BrowserWindow();
    attachAutoLock(win);
    fireWindowEvent('blur');
    jest.advanceTimersByTime(120_000);
    expect(lockSpy).not.toHaveBeenCalled();
  });

  test('blur is a noop when no PIN is set', () => {
    settingsStore.set({ lockEnabled: true });
    const lockSpy = jest.spyOn(appLockManager, 'lockNow');

    const win = new BrowserWindow();
    attachAutoLock(win);
    fireWindowEvent('blur');
    jest.advanceTimersByTime(120_000);
    expect(lockSpy).not.toHaveBeenCalled();
  });

  test('idle poll swallows powerMonitor errors and continues running', async () => {
    await appLockManager.setPin('1234');
    settingsStore.set({ lockEnabled: true, autoLockMs: 60_000 });
    const lockSpy = jest.spyOn(appLockManager, 'lockNow');

    const win = new BrowserWindow();
    attachAutoLock(win);

    (powerMonitor.getSystemIdleTime as jest.Mock).mockImplementationOnce(() => {
      throw new Error('powerMonitor unavailable');
    });
    expect(() => jest.advanceTimersByTime(30_000)).not.toThrow();
    expect(lockSpy).not.toHaveBeenCalled();

    // Subsequent ticks recover and can still lock.
    (powerMonitor.getSystemIdleTime as jest.Mock).mockReturnValue(120);
    jest.advanceTimersByTime(30_000);
    expect(lockSpy).toHaveBeenCalled();
  });

  test('attaching twice clears prior listeners and timers (idempotent)', async () => {
    await appLockManager.setPin('1234');
    const lockSpy = jest.spyOn(appLockManager, 'lockNow');

    const win1 = new BrowserWindow();
    attachAutoLock(win1);
    const win2 = new BrowserWindow();
    attachAutoLock(win2);

    // Blur on the active (win2) instance still arms a debounce; idempotency
    // is asserted via lockSpy firing exactly once when the timer fires.
    fireWindowEvent('blur');
    jest.advanceTimersByTime(31_000);
    expect(lockSpy).toHaveBeenCalledTimes(1);
  });
});
