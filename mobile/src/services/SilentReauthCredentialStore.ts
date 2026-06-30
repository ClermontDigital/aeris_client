import {SecureStorage} from './StorageService';

// SilentReauthCredentialStore — M3-C secure credential cache for silent
// re-authentication across an auto mode-switch.
// Source of truth: docs/PROJECT_DR_M3_BUILD_PLAN.md §M3-C, §3 guardrails.
//
// ============================ THREAT MODEL ============================
// This module caches a cashier's *login credentials* so the client can
// re-auth SILENTLY against the new edge after an AUTO mode-switch
// (cloud→NAS on failover, NAS→cloud on failback). After such a switch the
// audience-specific bearer is wiped (authStore.clearLocalSession) and
// auth.biometric CANNOT run (it needs a live token, which is gone) — so
// without this the cashier is bounced to a manual password screen mid-shift.
// Caching credentials is inherently sensitive; the mitigations are:
//
//  1. STOLEN/LOST DEVICE → protected by the OS secure enclave.
//     We persist via expo-secure-store (SecureStorage wrapper), backed by
//     the iOS Keychain / Android Keystore, with keychainAccessible =
//     WHEN_UNLOCKED_THIS_DEVICE_ONLY (set in StorageService). The secret is
//     encrypted at rest, never leaves the device (THIS_DEVICE_ONLY ⇒ not
//     synced to iCloud Keychain / not in device backups), and is only
//     readable while the device is unlocked. A powered-off or locked stolen
//     device yields nothing.
//
//  2. EXPLICIT LOGOUT WIPES.    clear() is called from authStore.logout()
//     (the deliberate "I'm leaving" path) and from drStore.flushForRepair()
//     (re-pair to a different deployment). A user who logs out leaves no
//     cached credential behind. (We deliberately do NOT wipe on the
//     401-driven clearLocalSession — that fires DURING an auto-switch and is
//     exactly when we need the cache to re-auth.)
//
//  3. PER-WORKSPACE SCOPE.      The credential is keyed by workspace code, and
//     load() requires the caller to pass the *current* workspace code; a
//     credential cached for workspace A is never returned for workspace B
//     (a roaming till never silently re-auths into another shop). On any
//     workspace mismatch we wipe.
//
//  4. FLAG-GATED.               NOTHING is cached unless autoFailoverEnabled is
//     ON. With the flag OFF (default everywhere) save() is a no-op, so a
//     default build holds ZERO cached credentials — provably no behaviour
//     change, and this whole sensitive surface is dormant until DR is enabled.
//
//  5. NO LOGGING.               Credentials are NEVER passed to console / logs.
//     This module does not log; callers must not log the returned object.
//
// This module gets its OWN security review (§M3-C). Every security decision
// is flagged inline above.
// =====================================================================

const CRED_KEY = 'aeris_silent_reauth_cred';
// Consecutive-failure counter key. A server-side password change leaves the
// cached credential permanently stale; without a TTL the silent-reauth path
// would re-try the dead credential on every future switch. We wipe the cache
// after N CONSECUTIVE silent-reauth failures so the cashier falls back to a
// manual login (which re-caches a fresh credential) rather than a dead cache.
const FAIL_COUNT_KEY = 'aeris_silent_reauth_failcount';
// Small N — a couple of transient network failures shouldn't nuke the cache,
// but a genuinely-changed password is cleared promptly.
export const MAX_SILENT_REAUTH_FAILURES = 3;

export interface CachedCredential {
  workspaceCode: string;
  email: string;
  password: string;
}

// Shape guard — a malformed/legacy blob must never crash the re-auth path.
function isCachedCredential(v: unknown): v is CachedCredential {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.workspaceCode === 'string' &&
    c.workspaceCode.length > 0 &&
    typeof c.email === 'string' &&
    c.email.length > 0 &&
    typeof c.password === 'string' &&
    c.password.length > 0
  );
}

// Normalize a workspace code the same way settingsStore.saveSettings does
// (trim + lowercase) so the per-workspace scope comparison is exact.
function normWorkspace(code: string | null | undefined): string {
  return (code ?? '').trim().toLowerCase();
}

export const SilentReauthCredentialStore = {
  // Cache the credentials for later silent re-auth.
  //
  // SECURITY GATE: `enabled` MUST be the live autoFailoverEnabled flag. When
  // false this is a hard no-op — no credential is ever written on a default
  // (flag-off) build. The caller (authStore.login) passes the flag so the
  // gate lives at the single write site.
  async save(
    enabled: boolean,
    workspaceCode: string | null,
    email: string,
    password: string,
  ): Promise<void> {
    if (!enabled) return; // flag OFF ⇒ never cache (default everywhere).
    const ws = normWorkspace(workspaceCode);
    if (!ws || !email || !password) return; // nothing scoped to cache against.
    const cred: CachedCredential = {workspaceCode: ws, email, password};
    try {
      await SecureStorage.setItem(CRED_KEY, JSON.stringify(cred));
      // A fresh credential (manual login or post-switch re-cache) resets the
      // consecutive-failure TTL counter — this is a known-good credential now.
      await this.resetFailures();
    } catch {
      // Keychain write failed — silent re-auth simply won't be available;
      // the cashier falls back to the normal login screen. Never surfaced.
    }
  },

  // Return the cached credential ONLY if it is usable for the given workspace.
  //
  // SECURITY GATE: `enabled` MUST be the live flag — with it off we never
  // return (and proactively wipe) any cached secret. Per-workspace scope is
  // enforced here: a credential cached for a DIFFERENT workspace is wiped and
  // not returned (anti cross-shop silent re-auth).
  async load(
    enabled: boolean,
    workspaceCode: string | null,
  ): Promise<CachedCredential | null> {
    if (!enabled) {
      // Flag flipped off (or never on) — make sure nothing lingers.
      await this.clear();
      return null;
    }
    let raw: string | null;
    try {
      raw = await SecureStorage.getItem(CRED_KEY);
    } catch {
      return null;
    }
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      await this.clear();
      return null;
    }
    if (!isCachedCredential(parsed)) {
      await this.clear();
      return null;
    }
    // Per-workspace scope: a cred from another deployment is never returned.
    if (parsed.workspaceCode !== normWorkspace(workspaceCode)) {
      await this.clear();
      return null;
    }
    return parsed;
  },

  // Wipe the cached credential. Called on explicit logout + on re-pair.
  // Best-effort: a Keychain failure must not block the auth wipe.
  async clear(): Promise<void> {
    try {
      await SecureStorage.removeItem(CRED_KEY);
    } catch {
      // Ignored — opportunistic wipe.
    }
    await this.resetFailures();
  },

  // Record a silent-reauth FAILURE. After MAX_SILENT_REAUTH_FAILURES
  // consecutive failures we wipe the cached credential (TTL) so a stale
  // credential — e.g. after a server-side password change — doesn't leave a
  // permanently-dead cache. A subsequent manual login re-caches a fresh one.
  // Returns true when the threshold was hit and the credential was wiped.
  async recordFailure(): Promise<boolean> {
    let count = 0;
    try {
      const raw = await SecureStorage.getItem(FAIL_COUNT_KEY);
      const parsed = raw != null ? Number(raw) : 0;
      count = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch {
      count = 0;
    }
    count += 1;
    if (count >= MAX_SILENT_REAUTH_FAILURES) {
      // Threshold reached — wipe the dead credential and the counter.
      await this.clear();
      return true;
    }
    try {
      await SecureStorage.setItem(FAIL_COUNT_KEY, String(count));
    } catch {
      // Best-effort — a counter write miss just delays the TTL by one cycle.
    }
    return false;
  },

  // Reset the consecutive-failure counter (on a successful save / wipe).
  async resetFailures(): Promise<void> {
    try {
      await SecureStorage.removeItem(FAIL_COUNT_KEY);
    } catch {
      // Ignored — opportunistic.
    }
  },
};
