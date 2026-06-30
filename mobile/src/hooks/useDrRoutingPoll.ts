import {useEffect} from 'react';
import {AppState, type AppStateStatus} from 'react-native';
import {useAuthStore} from '../stores/authStore';
import {useSettingsStore} from '../stores/settingsStore';
import {useDrStore} from '../stores/drStore';

// useDrRoutingPoll — M3-0 consumer of the `dr.routing` delivery seam.
// Source of truth: docs/PROJECT_DR_M3_BUILD_PLAN.md §M3-0-client, §1 option B.
//
// Calls drStore.pollDrRouting() (relay user-traffic) on a cadence while
// authenticated, feeding routing_target + partner_local_url through the
// existing validate→LAN-probe→commit pipeline in drStore, and persisting the
// M3-B failback signals. A flag-off / non-DR deployment 404s the action →
// pollDrRouting returns false and this is a no-op (M2 manual path).
//
// Mounted ONCE near the app root alongside usePresenceBeacon / useFailoverDetection.
//
// Cadence note: we poll the deployment's CACHED DR routing state, which only
// changes when the NAS self-reports a new address or an operator flips the
// directive — so a slow 60s cadence (matching the presence beacon) + an
// on-foreground refresh is ample. This is NOT the reachability probe (that is
// continuous relay traffic / the M3-A health probe); it is the address/
// directive delivery.
const DR_ROUTING_POLL_MS = 60_000;

export function useDrRoutingPoll(): void {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  // Only relay (cloud) mode can fetch dr.routing — in Direct mode we are
  // already on the NAS and the relay call is meaningless (and would route the
  // bearer the wrong way). Gate the poll on relay mode.
  const connectionMode = useSettingsStore(
    s => s.settings.connectionMode ?? 'relay',
  );

  useEffect(() => {
    if (!isAuthenticated || connectionMode !== 'relay') return;

    let interval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const startIntervalOnce = () => {
      if (interval || cancelled) return;
      interval = setInterval(() => {
        // Best-effort; never throws (pollDrRouting swallows transport errors).
        void useDrStore.getState().pollDrRouting();
      }, DR_ROUTING_POLL_MS);
    };

    // Discovery probe. Only begin steady-state polling if THIS deployment
    // actually serves DR. A non-DR / cloud-only deployment 404s the action
    // (pollDrRouting → false); we then stay silent — one probe per login (and
    // per foreground), NOT a 60s fleet-wide 404. Enabling DR is a deploy event,
    // so a re-login / next-foreground re-probe picks it up promptly.
    void useDrStore
      .getState()
      .pollDrRouting()
      .then(drServed => {
        if (!cancelled && drServed) startIntervalOnce();
      });

    // Re-probe on background→foreground: catches a directive change during a
    // backgrounded shift AND re-discovers DR if it was just enabled.
    let backgrounded = false;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background') {
        backgrounded = true;
        return;
      }
      if (state === 'active' && backgrounded) {
        backgrounded = false;
        void useDrStore
          .getState()
          .pollDrRouting()
          .then(drServed => {
            if (!cancelled && drServed) startIntervalOnce();
          });
      }
    });

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      sub.remove();
    };
  }, [isAuthenticated, connectionMode]);
}
