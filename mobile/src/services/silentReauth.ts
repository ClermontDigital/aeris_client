import ApiClient from './ApiClient';
import {SilentReauthCredentialStore} from './SilentReauthCredentialStore';
import {useAuthStore} from '../stores/authStore';
import {useSettingsStore} from '../stores/settingsStore';

// silentReauth — M3-C: re-authenticate against the new edge AFTER an auto
// mode-switch, with no manual password prompt.
// Source of truth: docs/PROJECT_DR_M3_BUILD_PLAN.md §M3-C.
//
// The shared tail of BOTH auto-switch directions (useAutoFailover cloud→NAS,
// useAutoFailback NAS→cloud). The caller has just:
//   1. clearLocalSession()  — wiped the audience-specific bearer (it can't be
//      forwarded to the new edge), and
//   2. saveSettings({connectionMode, baseUrl}) — pointed ApiClient at the new
//      target.
// At this point the cashier would normally land on the re-login screen. This
// helper attempts a SILENT login with the cached credentials so they keep
// working. On any failure it leaves the normal re-login banner in place.
//
// We use auth.login (NOT auth.biometric): biometric needs a LIVE token, which
// clearLocalSession just wiped, and is not on the gateway unauth allow-list.
// auth.login IS unauth-only, so it is the correct silent path post-switch.
//
// SECURITY: the cached credential is read ONLY when autoFailoverEnabled is ON
// (the load() gate) and ONLY for the active workspace (per-workspace scope).
// Credentials are never logged. See SilentReauthCredentialStore threat model.

export interface SilentReauthResult {
  // 'reauthed'   — silent login succeeded; session is live on the new edge.
  // 'no-cred'    — no usable cached credential (flag off, none saved, or
  //                workspace mismatch) → fall back to the manual login screen.
  // 'failed'     — a cached credential existed but the silent login failed
  //                (wrong password after a change, server rejected, network)
  //                → fall back to the manual login screen.
  outcome: 'reauthed' | 'no-cred' | 'failed';
}

export async function attemptSilentReauth(): Promise<SilentReauthResult> {
  const settings = useSettingsStore.getState().settings;
  const autoFailoverEnabled = settings.autoFailoverEnabled === true;
  const workspaceCode = settings.workspaceCode ?? null;

  // load() hard-gates on the flag and the per-workspace scope; a flag-off build
  // returns null here (and proactively wipes), so this is a no-op by default.
  const cred = await SilentReauthCredentialStore.load(
    autoFailoverEnabled,
    workspaceCode,
  );
  if (!cred) {
    return {outcome: 'no-cred'};
  }

  try {
    // Route through authStore.login so the new token is persisted + the store
    // flips isAuthenticated exactly as a manual login would (and the credential
    // is re-cached for the NEXT switch). authStore.login re-configures
    // ApiClient from the (already-updated) settings before calling.
    await useAuthStore.getState().login(cred.email, cred.password);
    // login() resolves only on success (it re-throws on failure). Clear any
    // stale "sign in again" banner the clearLocalSession set.
    useAuthStore.setState({error: null, errorKind: null});
    return {outcome: 'reauthed'};
  } catch {
    // Silent re-auth failed (password changed, server rejected, transport). DO
    // NOT surface the raw error; authStore.login already set an appropriate
    // banner. The cashier completes a normal manual login. We deliberately do
    // NOT wipe the cached credential — a transient network failure shouldn't
    // permanently disable silent re-auth; a genuinely-stale credential is
    // overwritten on the next successful manual login.
    return {outcome: 'failed'};
  }
}
