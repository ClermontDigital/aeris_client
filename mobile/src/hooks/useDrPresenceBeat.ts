import {useEffect, useRef} from 'react';
import {AppState, type AppStateStatus} from 'react-native';
import ApiClient from '../services/ApiClient';
import {getDeviceId} from '../services/PresenceService';
import {useAuthStore} from '../stores/authStore';
import {useSettingsStore} from '../stores/settingsStore';
import {useDrStore} from '../stores/drStore';

// useDrPresenceBeat — M3: post the route-proxied `dr.presence` beat so the
// deployment's live dr_presence count is real during a failover.
// Source of truth: docs/PROJECT_DR_M3_BUILD_PLAN.md §M3-0 (presence), §19.4.
//
// Closes the Wave-1 gap: usePresenceBeacon could not reach the gateway's
// tenant-key-only /dr/presence beacon (no deployment id, user bearer won't
// authenticate it). This beat instead POSTs {device_id, mode} over the RELAY,
// and the Aeris2 deployment forwards it to the gateway under ITS tenant key.
//
// SCOPE: beats ONLY while operating in Direct (NAS) mode + DR enabled on this
// deployment — i.e. during an actual failover, when a real per-device count
// matters for the operator's drain check. A normal cloud-only client makes
// ZERO new requests from this (Defect-2 preserved): the gate below short-
// circuits unless connectionMode==='direct' AND drStore.drEnabled.
//
// BEST-EFFORT / FIRE-AND-FORGET: ApiClient.reportDrPresence swallows every
// non-2xx (incl. 405/404 on flag-off deployments and NOT_FOUND envelopes) and
// any transport error, returning false. Nothing here ever surfaces to the UI.
//
// Cadence: 60s while foregrounded + authenticated, plus one beat on every
// background→foreground transition. Mounted ONCE near the app root.

const PRESENCE_BEAT_MS = 60_000;

export function useDrPresenceBeat(): void {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  const connectionMode = useSettingsStore(
    s => s.settings.connectionMode ?? 'relay',
  );

  // In-flight latch so an interval tick can't overlap a still-pending beat.
  const inFlight = useRef(false);

  useEffect(() => {
    // Only beat while authenticated AND operating in Direct (NAS) mode. A
    // cloud-mode client has nothing to report here (the cloud already sees its
    // user-traffic) — keeps cloud-only clients at zero extra requests.
    if (!isAuthenticated || connectionMode !== 'direct') return;

    const fire = () => {
      // Gate on DR actually being enabled on this deployment — without the
      // `dr` relay service the beat would always 404 (still a silent no-op,
      // but skip the wasted round-trip).
      if (!useDrStore.getState().drEnabled) return;
      if (inFlight.current) return;
      inFlight.current = true;
      void (async () => {
        try {
          const device_id = await getDeviceId();
          // We are in Direct mode → wire mode 'local'.
          await ApiClient.reportDrPresence({device_id, mode: 'local'});
        } catch {
          // Never throws to the caller, but guard anyway (device-id mint can
          // reject). Silent.
        } finally {
          inFlight.current = false;
        }
      })();
    };

    // Initial beat on entering Direct mode, then on the interval.
    fire();
    const interval = setInterval(fire, PRESENCE_BEAT_MS);

    // Extra beat on background→foreground so a returning device re-asserts
    // presence promptly.
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
  }, [isAuthenticated, connectionMode]);
}
