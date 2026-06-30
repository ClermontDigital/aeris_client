import {useEffect, useRef} from 'react';
import {useRoutingDecision} from './useRoutingDecision';
import {useAuthStore} from '../stores/authStore';
import {useSettingsStore} from '../stores/settingsStore';
import {attemptSilentReauth} from '../services/silentReauth';

// useAutoFailback — M3-B auto endpoint-swap orchestrator, CLOUD direction
// (NAS→cloud), FLAG-GATED. Mirror of useAutoFailover.
// Source of truth: docs/PROJECT_DR_M3_BUILD_PLAN.md §M3-B, §3 guardrails.
//
// Fires the reverse swap (Direct/NAS → relay/cloud) ONLY when the pure cascade
// returns reason='failback-ready', which by construction (routingDecisionService
// Rule 6) happens ONLY when ALL of:
//   - currentMode is 'local' (we are operating against the NAS), AND
//   - the cloud is reachable again AND has been SUSTAINED ≥ FAILBACK_HYSTERESIS_MS
//     (anti-flap hold window — cloudReachabilityStore.reachableSinceMs), AND
//   - reconcileQueueDrained is true — which M3-B now sources from the REAL
//     drain signal (drStore.failbackEligible = the deployment's server-side
//     `drained && no open conflicts`, delivered over the dr.routing seam). So
//     we NEVER fail back while the NAS→cloud outbox is draining or a conflict
//     is open, AND
//   - we are NOT mid-transaction (Rule 1 defers above Rule 6 — a failback never
//     interrupts a sale).
//
// FLAG ISOLATION (§3 guardrail 1): the cascade's Rule 6 is flag-INDEPENDENT (it
// must hold us in local without flapping regardless of the flag). So the
// autoFailoverEnabled GATE lives HERE: with the flag OFF this hook is a hard
// no-op, leaving failback as the M2 manual/prompt path exactly as before — the
// cascade still returns 'failback-ready' but NOTHING auto-switches. With the
// flag ON, this hook performs the swap. (Symmetric with useAutoFailover, where
// the gate is inside Rule 4; here Rule 6 stays flag-free so failback-hold's
// anti-flap behaviour is identical in both flag states, and only the ACT of
// switching is gated.)
//
// THE SWAP mirrors the manual Settings switch EXACTLY: clearLocalSession (the
// NAS-audience bearer must not be forwarded to the cloud edge) then saveSettings
// to relay mode, then a SILENT re-auth (M3-C) against the cloud with the cached
// credentials. relayUrl is already configured; switching connectionMode back to
// 'relay' is all that's needed for ApiClient to dispatch over the cloud again.
//
// ANTI-FLAP: a `swappedRef` latches once we initiate a failback so a re-render
// or brief decision oscillation can't double-fire. It resets once we are back in
// relay (cloud) mode, so a later genuine outage→recovery can failback afresh.
// The hold window that PREVENTS premature failback lives upstream (the
// FAILBACK_HYSTERESIS_MS sustained-reachable gate in the cascade); this ref only
// guards repeat-firing within a single recovery.
//
// Mounted ONCE near the app root.
export function useAutoFailback(): void {
  const {reason, deferred} = useRoutingDecision();
  // M3-B SINGLE GATE — flag OFF ⇒ this hook never auto-switches (≡ M2 manual
  // failback). Default OFF everywhere.
  const autoFailoverEnabled = useSettingsStore(
    s => s.settings.autoFailoverEnabled ?? false,
  );
  const connectionMode = useSettingsStore(
    s => s.settings.connectionMode ?? 'relay',
  );

  const swappedRef = useRef(false);

  useEffect(() => {
    // Reset the latch once we're safely back on the cloud (relay mode and not
    // in a failback decision) so a future recovery can auto-failback again.
    if (connectionMode === 'relay' && reason !== 'failback-ready') {
      swappedRef.current = false;
    }

    // FLAG GATE: with auto-failover OFF, failback stays manual (M2). Hard
    // no-op — never auto-switch.
    if (!autoFailoverEnabled) return;

    // Only act on a ready failback. Never while deferred (mid-transaction —
    // Rule 1) and never twice for the same recovery.
    if (reason !== 'failback-ready' || deferred || swappedRef.current) return;
    // Belt-and-braces: only fail BACK from direct (NAS) mode. If we're already
    // in relay (cloud) mode there is nothing to switch.
    if (connectionMode !== 'direct') return;

    swappedRef.current = true;

    void (async () => {
      const {clearLocalSession} = useAuthStore.getState();
      const {saveSettings} = useSettingsStore.getState();
      const isAuthenticated = useAuthStore.getState().isAuthenticated;

      // Clear the NAS-audience bearer before switching back to the cloud edge
      // (mirrors the manual path). Only meaningful when authenticated.
      if (isAuthenticated) {
        try {
          await clearLocalSession();
        } catch (e) {
          console.warn('[autoFailback] clearLocalSession failed:', e);
        }
        // Deliberate-switch copy so the forced re-login reads as the planned
        // return-to-cloud it is, not a malfunction. (Overwritten on a
        // successful silent re-auth below.)
        useAuthStore.setState({
          error:
            'Cloud is back online — switched to cloud mode automatically; sign in again to continue.',
        });
      }

      // Switch back to relay (cloud) mode. relayUrl is already configured, so
      // flipping connectionMode is sufficient (mirror of the manual switch).
      await saveSettings({
        connectionMode: 'relay',
      });

      // M3-C — silent re-auth against the cloud with the cached credentials.
      // No-op when the flag is off (can't reach here) or nothing is cached; on
      // success the cashier keeps working with no prompt.
      if (isAuthenticated) {
        try {
          await attemptSilentReauth();
        } catch (e) {
          console.warn('[autoFailback] silent re-auth threw:', e);
        }
      }
    })();
  }, [reason, deferred, connectionMode, autoFailoverEnabled]);
}
