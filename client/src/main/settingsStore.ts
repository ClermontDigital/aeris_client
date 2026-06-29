import Store from 'electron-store';
import { AppSettings, DEFAULT_SETTINGS } from '../shared-types/ipc';
import { logger } from './logger';
import { isLocalUrlSafeForCache } from './drUrlValidator';

// Thrown when a settings patch would persist (or activate) an unsafe Direct/LAN
// baseUrl. The renderer catches this off the settings.set() IPC reject and
// surfaces the message inline (DR §15-2 — the Direct baseUrl is the target the
// till re-authenticates against, so a poisoned value is a credential-harvest
// primitive; the renderer-side .trim() is NOT the authoritative check).
export class InvalidBaseUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidBaseUrlError';
  }
}

const INVALID_BASE_URL_MESSAGE =
  'In-store server URL must be an https:// address on your local network ' +
  '(a 10.x / 172.16-31.x / 192.168.x IP, or a single-label .local name).';

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
    // Fail-closed Direct/LAN baseUrl gate (DR §15-2 / §14.7). Enforced in MAIN
    // (trusted) so the renderer can't be the only check. Two cases:
    //   (a) the patch sets/changes baseUrl → the new value must validate;
    //   (b) the patch switches connectionMode to 'direct' → the (existing or
    //       newly-supplied) baseUrl must already be a valid LAN target, else we
    //       refuse to enter Direct mode and ship the bearer to an unsafe host.
    // A non-empty Direct baseUrl is always validated regardless of which key the
    // patch touched, so neither leg can be smuggled past in two steps.
    const baseUrlTouched = patch.baseUrl !== undefined;
    const modeTouched = patch.connectionMode !== undefined;
    const enteringDirect = next.connectionMode === 'direct';
    const baseUrl = (next.baseUrl ?? '').trim();
    if ((baseUrlTouched || modeTouched) && enteringDirect && baseUrl !== '') {
      if (!isLocalUrlSafeForCache(baseUrl)) {
        logger.warn('[settings] rejected unsafe Direct baseUrl', {
          baseUrlTouched,
          modeTouched,
        });
        throw new InvalidBaseUrlError(INVALID_BASE_URL_MESSAGE);
      }
    }
    // Refuse to ENTER Direct mode with no configured target at all — the
    // bearer would have nowhere safe to go (still fail-closed).
    if (modeTouched && enteringDirect && baseUrl === '') {
      logger.warn('[settings] rejected switch to Direct mode with no baseUrl');
      throw new InvalidBaseUrlError(
        'Set a valid in-store server URL before switching to in-store mode.',
      );
    }
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
