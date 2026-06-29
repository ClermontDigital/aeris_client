import {useEffect, useRef} from 'react';
import {AppState, type AppStateStatus} from 'react-native';
import ApiClient from '../services/ApiClient';
import {reportPresence} from '../services/PresenceService';
import {useAuthStore} from '../stores/authStore';
import {useSettingsStore} from '../stores/settingsStore';
import {useDrStore} from '../stores/drStore';
import {useRoutingDecision} from './useRoutingDecision';

// usePresenceBeacon — schedules the §19.4 presence beacon.
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §19.4, §22.5 Q3 (60s).
//
// Fires {device_id, mode, app_version}:
//   - every 60s while foregrounded + authenticated,
//   - and once on every background→foreground transition,
// to the marketplace (relay) when reachable AND to the NAS local registry when
// in Direct mode. Best-effort; never blocks the UI.
//
// Mounted once near the app root. Does nothing until the user is authenticated
// (a beacon from a logged-out device carries no useful fleet signal).

const BEACON_INTERVAL_MS = 60_000;

export function usePresenceBeacon(): void {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const {currentMode} = useRoutingDecision();
  // Read mode via a ref so the interval callback always sees the live value
  // without re-arming the timer on every mode flip.
  const modeRef = useRef(currentMode);
  modeRef.current = currentMode;

  useEffect(() => {
    if (!isAuthenticated) return;

    const fire = () => {
      const settings = useSettingsStore.getState().settings;
      const dr = useDrStore.getState();
      // Direct sink = the cached NAS target, only while operating in Direct
      // mode (§19.4) — this only happens during an actual failover.
      const directUrl =
        settings.connectionMode === 'direct' ? dr.cachedLocalUrl : null;

      // Relay (cloud) sink is GATED until the gateway /presence/beacon endpoint
      // ships. That endpoint does not exist yet, so emitting it for every
      // authenticated cloud user would be fleet-wide background 404 traffic
      // every 60s. Only fire the relay sink when DR is actually in use for this
      // client — i.e. the rails have provisioned a NAS failover target
      // (cachedLocalUrl present), the routing directive says local, or we are
      // already in Direct mode — OR when an operator explicitly opts in via the
      // presenceBeaconEnabled flag. A normal cloud-only client therefore makes
      // ZERO new background requests from this. Remove the gate once the
      // gateway presence contract lands (§22.5 Q10).
      const drInUse =
        dr.cachedLocalUrl != null ||
        dr.routingDirective === 'local' ||
        settings.connectionMode === 'direct';
      const relayUrl =
        (settings.presenceBeaconEnabled || drInUse)
          ? settings.relayUrl ?? null
          : null;
      // Nothing to send to.
      if (!relayUrl && !directUrl) return;
      // deploymentId: the gateway presence endpoint is deployment-scoped
      // (POST .../deployments/{id}/dr/presence). The mobile client pairs by
      // workspace code over relay RPC and does NOT hold a deployment id today,
      // so this is null — which suppresses every beacon in reportPresence and
      // keeps cloud-only clients at ZERO requests (Defect-2). M2 entry-criteria:
      // thread the real deployment id here once pairing/relay surfaces it AND a
      // user-scoped (or relay-forwarded) presence auth path exists — see the
      // M2 note in PresenceService.reportPresence.
      void reportPresence(modeRef.current, {
        relayUrl,
        directUrl,
        deploymentId: null,
        authToken: ApiClient.getAuthToken(),
      });
    };

    // Initial beacon on mount/auth, then on the interval.
    fire();
    const interval = setInterval(fire, BEACON_INTERVAL_MS);

    // Extra fire on background→foreground (§19.4).
    let backgrounded = false;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'background') {
        backgrounded = true;
        return;
      }
      if (state === 'active' && backgrounded) {
        backgrounded = false;
        fire();
      }
    });

    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [isAuthenticated]);
}
