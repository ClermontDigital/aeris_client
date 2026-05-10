import Store from 'electron-store';
import { AppSettings, DEFAULT_SETTINGS } from '../shared-types/ipc';
import { logger } from './logger';

// Plaintext electron-store for non-secret settings. The bearer token is
// stored separately via tokenStore (which uses safeStorage).

interface SettingsSchema {
  settings: AppSettings;
}

// Lazy: electron-store v10 calls app.getName() in its constructor, which
// throws before app.whenReady() fires. Module-level import happens during
// Electron's bootstrap, so we defer the actual `new Store(...)` until the
// first read/write.
let _store: Store<SettingsSchema> | null = null;
function getStore(): Store<SettingsSchema> {
  if (!_store) {
    _store = new Store<SettingsSchema>({
      name: 'aeris-settings',
      defaults: { settings: DEFAULT_SETTINGS },
    });
  }
  return _store;
}

type Listener = (next: AppSettings, prev: AppSettings) => void;
const listeners = new Set<Listener>();

function readSettings(): AppSettings {
  // Merge with defaults so a stored older shape that's missing new fields
  // doesn't break the app.
  const stored = (getStore() as unknown as {
    get: (k: string) => AppSettings | undefined;
  }).get('settings');
  return { ...DEFAULT_SETTINGS, ...(stored || {}) };
}

function writeSettings(next: AppSettings): void {
  (getStore() as unknown as {
    set: (k: string, v: AppSettings) => void;
  }).set('settings', next);
}

export const settingsStore = {
  get(): AppSettings {
    return readSettings();
  },
  set(patch: Partial<AppSettings>): AppSettings {
    const prev = readSettings();
    const next: AppSettings = { ...prev, ...patch };
    writeSettings(next);
    logger.info('[settings] updated', {
      changedKeys: Object.keys(patch),
    });
    listeners.forEach((l) => {
      try {
        l(next, prev);
      } catch (e) {
        logger.warn('[settings] listener threw', e);
      }
    });
    return next;
  },
  onChange(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  // Test-only reset hook.
  _reset(): void {
    writeSettings(DEFAULT_SETTINGS);
  },
};
