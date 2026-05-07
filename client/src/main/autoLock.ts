import { BrowserWindow, powerMonitor } from 'electron';
import { settingsStore } from './settingsStore';
import { lockNow, getAppLockState } from './appLockManager';
import { logger } from './logger';

// Auto-lock orchestration:
// - Window blur with a 30s debounce -> lockNow.
// - Idle timer polling powerMonitor.getSystemIdleTime() every 30s; when
//   idle >= autoLockMs -> lockNow.
// - Both gated on settings.lockEnabled and the presence of a PIN.

const BLUR_DEBOUNCE_MS = 30 * 1000;
const IDLE_POLL_MS = 30 * 1000;

let blurTimer: NodeJS.Timeout | null = null;
let idleInterval: NodeJS.Timeout | null = null;

function clearBlurTimer(): void {
  if (blurTimer) {
    clearTimeout(blurTimer);
    blurTimer = null;
  }
}

function shouldFire(): boolean {
  const s = settingsStore.get();
  if (!s.lockEnabled) return false;
  const lock = getAppLockState();
  if (!lock.isPinSet) return false;
  if (lock.locked) return false;
  return true;
}

function tryLock(reason: string): void {
  if (!shouldFire()) return;
  logger.info(`[autoLock] firing lockNow (${reason})`);
  lockNow();
}

export function attachAutoLock(win: BrowserWindow): void {
  // Blur path with debounce. If the user comes back inside the window
  // within the debounce window we cancel.
  win.on('blur', () => {
    clearBlurTimer();
    blurTimer = setTimeout(() => tryLock('window-blur'), BLUR_DEBOUNCE_MS);
  });
  win.on('focus', () => clearBlurTimer());
  win.on('closed', () => {
    clearBlurTimer();
    if (idleInterval) {
      clearInterval(idleInterval);
      idleInterval = null;
    }
  });

  // Idle poll. powerMonitor.getSystemIdleTime() returns seconds since last
  // user input. When that exceeds autoLockMs, lock.
  if (idleInterval) clearInterval(idleInterval);
  idleInterval = setInterval(() => {
    try {
      const idleSec = powerMonitor.getSystemIdleTime();
      const idleMs = idleSec * 1000;
      const { autoLockMs } = settingsStore.get();
      if (autoLockMs > 0 && idleMs >= autoLockMs) {
        tryLock(`idle-${idleSec}s`);
      }
    } catch (e) {
      logger.warn('[autoLock] idle poll failed', e);
    }
  }, IDLE_POLL_MS);
  // Don't keep the event loop alive solely for the auto-lock poller.
  idleInterval.unref?.();
}

export function detachAutoLockForTests(): void {
  clearBlurTimer();
  if (idleInterval) {
    clearInterval(idleInterval);
    idleInterval = null;
  }
}
