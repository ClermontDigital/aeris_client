import {useEffect, useRef} from 'react';
import {AppState, type AppStateStatus} from 'react-native';
import ApiClient from '../services/ApiClient';
import {getDeviceId} from '../services/PresenceService';
import {useAuthStore} from '../stores/authStore';
import {useSettingsStore} from '../stores/settingsStore';
import {useDrStore} from '../stores/drStore';
import {useRoutingDecision} from './useRoutingDecision';

// usePresenceBeacon — the SINGLE DR presence beacon owner (cloud AND local).
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §19.4, §22.5 Q3 (60s)
// + SITREP_DR_MOBILE_TEAM.md (the beacon is load-bearing: the marketplace's
// cutover-safety gate refuses `local` unless it sees a fresh client beacon).
//
// Emits {device_id, mode} through the route-proxied `dr.presence` action — the
// client posts to its OWN Aeris2 deployment, which forwards a per-device beat
// to the gateway under its tenant key (RelayClient.reportDrPresence maps the
// routing vocab local→'direct' at that boundary). Aeris2 rolls the beats up to
// a single presence count the marketplace gate reads. Fire-and-forget: a
// non-DR deployment 404s and is swallowed, so this never surfaces an error.
//
// Cadence: every 60s while foregrounded + authenticated, plus one beat on each
// background→foreground transition, plus an immediate beat the moment DR
// discovery flips `drEnabled` true (so the gate is armed within the login round-
// trip, not up to a minute later). TTL is 180s server-side.
//
// GATE: only DR-provisioned deployments beacon (drStore.drEnabled — the last
// dr.routing poll saw a DR surface), OR an operator opts in via
// presenceBeaconEnabled. Fires in CLOUD mode too — deliberately, so the gate
// sees a listening client BEFORE an operator flips to local (else every real
// cutover needs a `?force`). A normal cloud-only client makes zero beacon
// traffic. This is the sole beacon — usePresenceBeacon owns both modes.

const BEACON_INTERVAL_MS = 60_000;

export function usePresenceBeacon(): void {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const drEnabled = useDrStore(s => s.drEnabled);
  const beaconOptIn = useSettingsStore(
    s => s.settings.presenceBeaconEnabled ?? false,
  );
  const {currentMode} = useRoutingDecision();
  // Read mode via a ref so the interval callback always sees the live value
  // without re-arming the timer on every mode flip.
  const modeRef = useRef(currentMode);
  modeRef.current = currentMode;
  // In-flight latch so a tick can't stack a second beat over a pending one.
  const inFlight = useRef(false);

  useEffect(() => {
    // Only beat for a DR-provisioned deployment (or operator opt-in), while
    // authenticated. Re-runs — and thus fires immediately — when `drEnabled`
    // transitions true after discovery, removing the up-to-60s arming latency.
    if (!isAuthenticated || (!drEnabled && !beaconOptIn)) return;

    const fire = () => {
      if (inFlight.current) return;
      inFlight.current = true;
      // Routing vocab → beacon vocab: RelayClient maps 'local'→'direct'; every
      // other mode beats as 'cloud'.
      const mode: 'cloud' | 'local' =
        modeRef.current === 'local' ? 'local' : 'cloud';
      void getDeviceId()
        .then(device_id => ApiClient.reportDrPresence({device_id, mode}))
        .catch(() => undefined)
        .finally(() => {
          inFlight.current = false;
        });
    };

    fire();
    const interval = setInterval(fire, BEACON_INTERVAL_MS);

    // Extra beat on background→foreground (§19.4).
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
  }, [isAuthenticated, drEnabled, beaconOptIn]);
}
