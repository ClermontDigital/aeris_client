import { safeStorage } from 'electron';
import Store from 'electron-store';
import { logger } from './logger';

// silentReauthStore (Electron main) — M3-C secure credential cache for silent
// re-authentication across an AUTO mode-switch. Electron counterpart of
// mobile's SilentReauthCredentialStore.
// Source of truth: docs/PROJECT_DR_M3_BUILD_PLAN.md §M3-C, §3 guardrails.
//
// ============================ THREAT MODEL ============================
// This module caches a cashier's *login credentials* (workspace + email +
// password) so the till can re-auth SILENTLY against the new edge after an
// AUTO mode-switch (cloud→NAS failover, NAS→cloud failback). After such a
// switch the audience-specific bearer is wiped (authManager.handleModeSwitch);
// auth.biometric is not used on desktop and would need a live token anyway —
// so without this cache the cashier is bounced to a manual password screen
// mid-shift. Caching credentials is inherently sensitive; the mitigations:
//
//  1. STOLEN/LOST DEVICE → protected by the OS secure store.
//     The credential blob is encrypted with Electron `safeStorage`
//     (macOS Keychain / Windows DPAPI / Linux libsecret) BEFORE being written
//     to electron-store, exactly like the bearer in tokenStore. The plaintext
//     never touches disk. On a platform with no secret-service daemon
//     (headless Linux), safeStorage.isEncryptionAvailable() is false — and we
//     FAIL CLOSED: nothing is cached at all (unlike tokenStore which keeps a
//     plaintext-bearer fallback, a *password* must never be written plaintext).
//
//  2. EXPLICIT LOGOUT WIPES.   clear() is called from authManager.logout()
//     (the deliberate "I'm leaving" path). We deliberately do NOT wipe on the
//     401-driven handleUnauthorized / handleModeSwitch — those fire DURING an
//     auto-switch and are exactly when the cache is needed to re-auth.
//
//  3. PER-WORKSPACE SCOPE.     The credential is keyed by workspace code and
//     load() requires the *current* workspace code; a credential cached for
//     workspace A is never returned for B (a roaming till never silently
//     re-auths into another shop). On any mismatch we wipe.
//
//  4. FLAG-GATED.              NOTHING is cached unless autoFailoverEnabled is
//     ON. With the flag OFF (default everywhere) save() is a hard no-op, so a
//     default build holds ZERO cached credentials — provably no behaviour
//     change, and this whole sensitive surface is dormant until DR is enabled.
//
//  5. NO LOGGING.              The password is NEVER passed to console / logs.
//     This module logs only non-secret breadcrumbs (e.g. "wrote cred",
//     "encryption unavailable"); callers must not log the returned object.
//
// This module gets its OWN security review (§M3-C). Every security decision is
// flagged inline above.
// =====================================================================

const CRED_KEY = 'cred';
const FAIL_COUNT_KEY = 'failCount';
// TTL (mobile parity): a server-side password change leaves the cached
// credential permanently stale. Wipe the cache after N CONSECUTIVE silent-
// reauth failures so the cashier falls back to a manual login (which re-caches
// a fresh credential) rather than re-trying a dead credential forever.
export const MAX_SILENT_REAUTH_FAILURES = 3;

export interface CachedCredential {
  workspaceCode: string;
  email: string;
  password: string;
}

interface SilentReauthSchema {
  // safeStorage-encrypted JSON blob (base64) of CachedCredential, or null.
  cred: string | null;
  // Consecutive silent-reauth failure counter for the TTL.
  failCount: number;
}

// Lazy — see tokenStore.ts (electron-store v10 needs app.getName() at
// construction, which throws before app.whenReady()).
let _store: Store<SilentReauthSchema> | null = null;
function getStore(): Store<SilentReauthSchema> {
  if (!_store) {
    _store = new Store<SilentReauthSchema>({
      name: 'aeris-silent-reauth',
      defaults: { cred: null, failCount: 0 },
    });
  }
  return _store;
}

let cachedEncryptionAvailable: boolean | null = null;
function isEncryptionAvailable(): boolean {
  if (cachedEncryptionAvailable !== null) return cachedEncryptionAvailable;
  try {
    cachedEncryptionAvailable = safeStorage.isEncryptionAvailable();
  } catch {
    cachedEncryptionAvailable = false;
  }
  return cachedEncryptionAvailable;
}

const rawGet = (): string | null =>
  ((getStore() as unknown as { get: (k: string) => unknown }).get(
    CRED_KEY,
  ) as string | null) ?? null;
const rawSet = (value: string | null): void =>
  (getStore() as unknown as { set: (k: string, v: unknown) => void }).set(
    CRED_KEY,
    value,
  );

const rawGetFailCount = (): number => {
  const v = (getStore() as unknown as { get: (k: string) => unknown }).get(
    FAIL_COUNT_KEY,
  );
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
};
const rawSetFailCount = (n: number): void =>
  (getStore() as unknown as { set: (k: string, v: unknown) => void }).set(
    FAIL_COUNT_KEY,
    n,
  );

function normWorkspace(code: string | null | undefined): string {
  return (code ?? '').trim().toLowerCase();
}

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

export const silentReauthStore = {
  // Cache the credentials for later silent re-auth.
  //
  // SECURITY GATE: `enabled` MUST be the live autoFailoverEnabled flag. When
  // false this is a hard no-op — no credential is ever written on a default
  // (flag-off) build. Also FAIL CLOSED when OS encryption is unavailable: we
  // refuse to write a plaintext password.
  async save(
    enabled: boolean,
    workspaceCode: string | null,
    email: string,
    password: string,
  ): Promise<void> {
    if (!enabled) return; // flag OFF ⇒ never cache (default everywhere).
    const ws = normWorkspace(workspaceCode);
    if (!ws || !email || !password) return;
    if (!isEncryptionAvailable()) {
      // No secret-service daemon — never persist a plaintext password.
      logger.warn(
        '[silentReauth] OS encryption unavailable — NOT caching credentials ' +
          '(silent re-auth will fall back to the manual login screen).',
      );
      return;
    }
    const cred: CachedCredential = { workspaceCode: ws, email, password };
    try {
      const encrypted = safeStorage
        .encryptString(JSON.stringify(cred))
        .toString('base64');
      rawSet(encrypted);
      // Fresh known-good credential — reset the TTL failure counter.
      await this.resetFailures();
    } catch (e) {
      // Keychain write failed — silent re-auth simply won't be available.
      logger.warn('[silentReauth] credential encrypt/write failed', e);
    }
  },

  // Return the cached credential ONLY if usable for the given workspace.
  //
  // SECURITY GATE: `enabled` MUST be the live flag — with it off we never
  // return (and proactively wipe) any cached secret. Per-workspace scope is
  // enforced: a credential for a DIFFERENT workspace is wiped and not returned.
  async load(
    enabled: boolean,
    workspaceCode: string | null,
  ): Promise<CachedCredential | null> {
    if (!enabled) {
      await this.clear();
      return null;
    }
    if (!isEncryptionAvailable()) return null;
    const raw = rawGet();
    if (!raw) return null;
    let plaintext: string;
    try {
      plaintext = safeStorage.decryptString(Buffer.from(raw, 'base64'));
    } catch {
      await this.clear();
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(plaintext);
    } catch {
      await this.clear();
      return null;
    }
    if (!isCachedCredential(parsed)) {
      await this.clear();
      return null;
    }
    if (parsed.workspaceCode !== normWorkspace(workspaceCode)) {
      await this.clear();
      return null;
    }
    return parsed;
  },

  // Wipe the cached credential. Called on explicit logout. Best-effort.
  async clear(): Promise<void> {
    try {
      rawSet(null);
    } catch {
      // Ignored — opportunistic wipe.
    }
    await this.resetFailures();
  },

  // Record a silent-reauth FAILURE. After MAX_SILENT_REAUTH_FAILURES
  // consecutive failures the cached (stale) credential is wiped so a server-
  // side password change doesn't leave a permanently-dead cache. A subsequent
  // manual login re-caches a fresh credential. Returns true when wiped.
  async recordFailure(): Promise<boolean> {
    let count = 0;
    try {
      count = rawGetFailCount();
    } catch {
      count = 0;
    }
    count += 1;
    if (count >= MAX_SILENT_REAUTH_FAILURES) {
      await this.clear();
      return true;
    }
    try {
      rawSetFailCount(count);
    } catch {
      // Best-effort — a counter write miss just delays the TTL by one cycle.
    }
    return false;
  },

  // Reset the consecutive-failure counter (on a successful save / wipe).
  async resetFailures(): Promise<void> {
    try {
      rawSetFailCount(0);
    } catch {
      // Ignored — opportunistic.
    }
  },

  // Test-only reset of the cached encryption-available flag.
  _resetCache(): void {
    cachedEncryptionAvailable = null;
  },
};
