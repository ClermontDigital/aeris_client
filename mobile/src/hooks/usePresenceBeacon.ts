import {useEffect, useRef} from 'react';
import {AppState, type AppStateStatus} from 'react-native';
import ApiClient from '../services/ApiClient';
import {getDeviceId} from '../services/PresenceService';
import {useAuthStore} from '../stores/authStore';
import {useSettingsStore} from '../stores/settingsStore';
import {useDrStore} from '../stores/drStore';
import {useRoutingDecision} from './useRoutingDecision';

// usePresenceBeacon — the §19.4 DR presence beacon.
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §19.4, §22.5 Q3 (60s)
// + SITREP_DR_MOBILE_TEAM.md (the beacon is load-bearing: the marketplace's
// cutover-safety gate refuses `local` unless it sees a fresh client beacon).
//
// Emits {device_id, mode} through the route-proxied `dr.presence` action — the
// client posts to its OWN Aeris2 deployment, which forwards a per-device beat
// to the gateway under its tenant key (RelayClient.reportDrPresence; the mode
// vocab is mapped local→'direct' at that boundary). Aeris2 rolls the beats up
// to a single presence count the marketplace gate reads. Fire-and-forget: a
// non-DR deployment 404s and is swallowed, so this never surfaces an error.
//
// Cadence: every 60s while foregrounded + authenticated, plus once on each
// background→foreground transition (TTL is 180s server-side, so 60s keeps the
// device continuously "fresh").
//
// GATE: only DR-provisioned deployments beacon (drStore.drEnabled — the last
// dr.routing poll saw a DR surface), OR an operator opts in via
// presenceBeaconEnabled. This fires in CLOUD mode too — that's deliberate: the
// gate must see a listening client BEFORE an operator flips to local, or every
// real cutover needs a `?force`. A normal cloud-only (non-DR) client makes zero
// beacon traffic.

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
      const dr = useDrStore.getState();
      const {presenceBeaconEnabled} = useSettingsStore.getState().settings;
      // Only beacon when DR is actually provisioned for this deployment (or an
      // operator opts in) — otherwise a cloud-only fleet would emit a relay RPC
      // every 60s for nothing.
      if (!dr.drEnabled && !presenceBeaconEnabled) return;

      // Routing vocab → beacon vocab: RelayClient maps 'local'→'direct' at the
      // wire; everything else beats as 'cloud'.
      const mode: 'cloud' | 'local' =
        modeRef.current === 'local' ? 'local' : 'cloud';

      // Best-effort; getDeviceId mints+persists a stable per-device UUID.
      void getDeviceId()
        .then(device_id => ApiClient.reportDrPresence({device_id, mode}))
        .catch(() => undefined);
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
