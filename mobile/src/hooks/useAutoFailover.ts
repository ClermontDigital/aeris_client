import {useEffect, useRef} from 'react';
import {useRoutingDecision} from './useRoutingDecision';
import {useAuthStore} from '../stores/authStore';
import {useSettingsStore} from '../stores/settingsStore';
import {useDrStore} from '../stores/drStore';

// useAutoFailover — M3-A auto endpoint-swap orchestrator (FLAG-GATED).
// Source of truth: docs/PROJECT_DR_M3_BUILD_PLAN.md §M3-A, §3 guardrails.
//
// The SINGLE side-effecting consumer of the cascade's auto-failover decision.
// It fires ONLY when the pure cascade returns reason='outage-auto', which by
// construction (routingDecisionService Rule 4) happens ONLY when:
//   - autoFailoverEnabled is true (the M3-D flag — default OFF), AND
//   - the cloud is unreachable per the cloudReachabilityStore hysteresis
//     (UNREACHABLE_AFTER_FAILURES consecutive transport failures), AND
//   - a validated NAS target is currently reachable (live health probe), AND
//   - certTrust !== 'mismatch' (fail-closed — M-R3), AND
//   - we are NOT mid-transaction (Rule 1 defers above auto-swap).
// Flag OFF ⇒ the cascade returns 'outage-prompt' instead and this hook is a
// no-op — flag-off is provably ≡ the M2 manual prompt path.
//
// THE SWAP mirrors the manual Settings switch EXACTLY (SettingsModal.handleSave
// modeChanged branch): clear the local session (the bearer is audience-specific
// and must not be forwarded to the new edge — §M3-C) then save the new mode +
// base URL. Per the M3 scope, after an auto-swap the user is left at the
// re-login prompt (silent re-login is M3-C, next agent). We set the same
// deliberate-switch copy the manual path uses so it doesn't read as a crash.
//
// ANTI-FLAP / debounce: a `swappedRef` latches once we initiate a swap so a
// re-render (or a brief decision oscillation) cannot fire a second swap. It
// resets once we are back in relay mode with the cloud reachable again, so a
// later, genuinely-new outage can auto-swap afresh. The hysteresis that
// PREVENTS premature switching lives upstream (cloudReachabilityStore needs N
// consecutive failures before cloudReachable flips false); this ref guards
// against repeat-firing within a single outage.
//
// Mounted ONCE near the app root.
export function useAutoFailover(): void {
  const {reason, deferred} = useRoutingDecision();
  const connectionMode = useSettingsStore(
    s => s.settings.connectionMode ?? 'relay',
  );

  const swappedRef = useRef(false);

  useEffect(() => {
    // Reset the latch once we're safely back on the cloud (relay mode and not
    // in an outage decision) so a future outage can auto-swap again.
    if (connectionMode === 'relay' && reason !== 'outage-auto') {
      swappedRef.current = false;
    }

    // Only act on the auto-failover decision. Never while deferred
    // (mid-transaction) and never twice for the same outage.
    if (reason !== 'outage-auto' || deferred || swappedRef.current) return;
    // Belt-and-braces: only swap FROM relay (cloud) mode. If we're already in
    // direct mode there is nothing to switch.
    if (connectionMode !== 'relay') return;

    const target = useDrStore.getState().cachedLocalUrl;
    if (!target) return; // nasUsable should guarantee this, but be safe.

    swappedRef.current = true;

    void (async () => {
      const {clearLocalSession} = useAuthStore.getState();
      const {saveSettings} = useSettingsStore.getState();
      const isAuthenticated = useAuthStore.getState().isAuthenticated;

      // Clear the audience-specific bearer before switching edges (mirrors the
      // manual path). Only meaningful when authenticated.
      if (isAuthenticated) {
        try {
          await clearLocalSession();
        } catch (e) {
          console.warn('[autoFailover] clearLocalSession failed:', e);
        }
        // Deliberate-switch copy (matches SettingsModal) so the forced
        // re-login reads as the in-store cutover it is, not a malfunction.
        useAuthStore.setState({
          error:
            'Switched to on-prem mode automatically — sign in again to continue.',
        });
      }

      await saveSettings({
        connectionMode: 'direct',
        baseUrl: target,
      });
    })();
  }, [reason, deferred, connectionMode]);
}
