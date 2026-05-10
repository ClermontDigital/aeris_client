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
let attachedWindow: BrowserWindow | null = null;
let blurHandler: (() => void) | null = null;
let focusHandler: (() => void) | null = null;
let closedHandler: (() => void) | null = null;

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

function detachPrevious(): void {
  clearBlurTimer();
  if (idleInterval) {
    clearInterval(idleInterval);
    idleInterval = null;
  }
  if (attachedWindow && !attachedWindow.isDestroyed()) {
    if (blurHandler) attachedWindow.removeListener('blur', blurHandler);
    if (focusHandler) attachedWindow.removeListener('focus', focusHandler);
    if (closedHandler) attachedWindow.removeListener('closed', closedHandler);
  }
  attachedWindow = null;
  blurHandler = null;
  focusHandler = null;
  closedHandler = null;
}

export function attachAutoLock(win: BrowserWindow): void {
  // Idempotent: clear any previous attachment first so a macOS
  // reactivate doesn't accumulate listeners or interval timers.
  detachPrevious();
  attachedWindow = win;

  blurHandler = () => {
    clearBlurTimer();
    blurTimer = setTimeout(() => tryLock('window-blur'), BLUR_DEBOUNCE_MS);
  };
  focusHandler = () => clearBlurTimer();
  closedHandler = () => {
    clearBlurTimer();
    if (idleInterval) {
      clearInterval(idleInterval);
      idleInterval = null;
    }
  };
  win.on('blur', blurHandler);
  win.on('focus', focusHandler);
  win.on('closed', closedHandler);

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
  detachPrevious();
}
