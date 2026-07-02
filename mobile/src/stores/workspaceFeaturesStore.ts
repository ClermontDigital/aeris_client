import {create} from 'zustand';
import {SecureStorage} from '../services/StorageService';

// workspaceFeaturesStore — mirrors AuthResponse.workspace.features (see
// shared/src/types/api.types.ts:18-24). Hydrated at the auth boundary
// (login / refreshSession / restoreSession) and persisted to SecureStorage
// so a warm boot restores prior state before the first RPC. Missing fields
// coerce to false — a pre-flag deployment never accidentally lights up the
// Repairs surface (see the T3 REPAIRS_DISABLED_CODE branch which flips the
// flag off + toasts once when the gateway says the workspace is disabled).

const WORKSPACE_FEATURES_KEY = 'aeris.workspace.features';

// Same shape guard as settingsStore.ts:23-25 — defends against shape drift
// where an older build persisted `null`/`undefined` under the same key.
function pickBoolean(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

interface PersistedWorkspaceFeatures {
  repairs_enabled: boolean;
}

interface WorkspaceFeaturesState {
  repairs_enabled: boolean;
  // Hydrate from an AuthResponse-shaped payload. Accepts unknown so a
  // malformed login body from a stale deployment coerces safely rather
  // than crashing the auth store on shape mismatch.
  hydrateFromLogin: (raw: unknown) => void;
  setRepairsEnabled: (v: boolean) => void;
  reset: () => void;
}

function persist(state: PersistedWorkspaceFeatures): void {
  // Best-effort — never blocks a caller. A Keychain write failure just means
  // the warm-boot restore will see stale data; the next login re-hydrates.
  void SecureStorage.setItem(
    WORKSPACE_FEATURES_KEY,
    JSON.stringify(state),
  ).catch(() => {});
}

function readRepairsFromLogin(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  // Canonical shape per shared/src/types/api.types.ts:
  //   raw.workspace.features.repairs_enabled
  const w = r.workspace;
  if (w && typeof w === 'object') {
    const features = (w as Record<string, unknown>).features;
    if (features && typeof features === 'object') {
      const v = (features as Record<string, unknown>).repairs_enabled;
      if (typeof v === 'boolean') return v;
    }
    // Also tolerate `raw.workspace.repairs_enabled` (features missing).
    const direct = (w as Record<string, unknown>).repairs_enabled;
    if (typeof direct === 'boolean') return direct;
  }
  // Shape-tolerant fallbacks so a deployment that ships the flag under a
  // slightly different key still lights up the tab. Ordered narrowest ->
  // broadest so a partial rollout with the flag under features / at root
  // still works.
  const featuresTop = r.features;
  if (featuresTop && typeof featuresTop === 'object') {
    const v = (featuresTop as Record<string, unknown>).repairs_enabled;
    if (typeof v === 'boolean') return v;
  }
  const rootFlag = r.repairs_enabled;
  if (typeof rootFlag === 'boolean') return rootFlag;
  return false;
}

export const useWorkspaceFeaturesStore = create<WorkspaceFeaturesState>(
  set => ({
    repairs_enabled: false,

    hydrateFromLogin: (raw: unknown) => {
      const repairs_enabled = readRepairsFromLogin(raw);
      set({repairs_enabled});
      persist({repairs_enabled});
    },

    setRepairsEnabled: (v: boolean) => {
      const repairs_enabled = pickBoolean(v, false);
      set({repairs_enabled});
      persist({repairs_enabled});
    },

    // Called from authStore.logout to prevent cross-user residue on shared
    // devices — user A (workspace with repairs) logs out, user B logs into a
    // workspace with repairs off, and during the interim (login screen +
    // warm-boot race before restoreSession completes) the stale `true` must
    // not survive. Removes the SecureStorage entry entirely so a stale
    // parse can't reintroduce the flag before hydrateFromLogin runs.
    reset: () => {
      set({repairs_enabled: false});
      void SecureStorage.removeItem(WORKSPACE_FEATURES_KEY).catch(() => {});
    },
  }),
);

// Warm-boot restore. Exposed as `hydrationPromise` so authStore.restoreSession
// can await it before setting isAuthenticated — prevents the "Repairs tab
// appears/disappears at first render" race where restoreSession finishes
// before the async SecureStorage read resolves.
export const hydrationPromise: Promise<void> = (async () => {
  try {
    const stored = await SecureStorage.getItem(WORKSPACE_FEATURES_KEY);
    if (!stored) return;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return;
    const repairs_enabled = pickBoolean(
      (parsed as Record<string, unknown>).repairs_enabled,
      false,
    );
    useWorkspaceFeaturesStore.setState({repairs_enabled});
  } catch {
    // Malformed payload — leave the default (false) in place. The next
    // login will overwrite the corrupt entry.
  }
})();
