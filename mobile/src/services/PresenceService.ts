import {Platform} from 'react-native';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import {SecureStorage} from './StorageService';
import {resolveFetchUrl} from '../constants/config';
import type {RoutingMode} from '../types/dr.types';

// PresenceService — the §19.4 connected-client presence beacon.
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §19.4, §22.5 Q2/Q3/Q10.
//
// Each app reports {device_id, mode, app_version} so an operator can confirm
// the fleet has drained before taking the cloud offline. Device id, NOT PII;
// count + mode, not identity.
//
// Two sinks (§19.4):
//   - Marketplace (relay path) when the cloud is reachable.
//   - The NAS local registry (POST /presence/beacon) whenever in Direct mode
//     — the authoritative source during a true outage.
//
// device_id (§22.5 Q2): a mint-on-first-launch UUID persisted in SecureStore.
// Preferred over the raw expo-application IDs because it survives reinstall
// (iOS getIosIdForVendorAsync resets when the last vendor app is removed) and
// is a stable, non-PII opaque token. expo-application IDs are the fallback
// only if SecureStore is unavailable.

const DEVICE_ID_KEY = 'aeris_dr_device_id';
const BEACON_TIMEOUT_MS = 5_000;

// The gateway exposes presence ONLY at the authenticated, tenant-scoped,
// deployment-scoped path (go-api/cmd/api/main.go ~:712 →
// RecordPresence in go-api/internal/handlers/tenant/dr.go). There is NO flat
// /api/v1/presence/beacon route on either the gateway or the Aeris2 deployment.
// The path carries the deployment id (chi URL param `{id}`).
function beaconPath(deploymentId: string): string {
  return `/api/v1/tenant/deployments/${encodeURIComponent(
    deploymentId,
  )}/dr/presence`;
}

// The gateway accepts ONLY mode ∈ {cloud, local} (dr.go validPresenceModes,
// ~:46-49 + the per-device validation ~:249-250). The client's RoutingMode has
// four values; collapse to the two wire values before POSTing:
//   local                      → local  (selling against the NAS)
//   cloud | switching | offline → cloud  (cloud is the default/last authority;
//                                 switching/offline are transient client-only
//                                 states the gateway has no vocabulary for)
function toWireMode(mode: RoutingMode): 'cloud' | 'local' {
  return mode === 'local' ? 'local' : 'cloud';
}

let cachedDeviceId: string | null = null;

// Mint-on-first-launch, SecureStore-persisted, opaque device id (§22.5 Q2).
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  try {
    const existing = await SecureStorage.getItem(DEVICE_ID_KEY);
    if (existing) {
      cachedDeviceId = existing;
      return existing;
    }
    const minted = Crypto.randomUUID();
    await SecureStorage.setItem(DEVICE_ID_KEY, minted);
    cachedDeviceId = minted;
    return minted;
  } catch {
    // SecureStore unavailable — fall back to a stable platform id (non-
    // persisted across reinstall, but better than nothing for this beacon).
    let platformId: string | null = null;
    try {
      platformId =
        Platform.OS === 'android'
          ? Application.getAndroidId()
          : await Application.getIosIdForVendorAsync();
    } catch {
      platformId = null;
    }
    const fallback = platformId || Crypto.randomUUID();
    cachedDeviceId = fallback;
    return fallback;
  }
}

// Wire shape of a per-device beacon — field names + value domain confirmed
// against the gateway's PresenceBeaconRequest (dr.go ~:173-178). `mode` is the
// collapsed wire enum (cloud|local), NOT the 4-value client RoutingMode.
export interface PresenceBeacon {
  device_id: string;
  mode: 'cloud' | 'local';
  app_version: string;
}

export async function buildBeacon(mode: RoutingMode): Promise<PresenceBeacon> {
  const device_id = await getDeviceId();
  return {
    device_id,
    mode: toWireMode(mode),
    app_version: Application.nativeApplicationVersion ?? 'unknown',
  };
}

// POST the beacon to one sink. Best-effort + short timeout — a presence push
// must never block or surface errors to the cashier. Returns true on a 2xx.
//
// `authToken` rides as a bearer so the NAS/relay can scope the beacon to the
// caller's deployment (tenant-scoped — §19.4). Never logs the beacon.
async function postBeacon(
  baseUrl: string,
  deploymentId: string,
  beacon: PresenceBeacon,
  authToken: string | null,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BEACON_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(
      resolveFetchUrl(`${baseUrl}${beaconPath(deploymentId)}`),
      {
        method: 'POST',
        headers,
        body: JSON.stringify(beacon),
        signal: controller.signal,
      },
    );
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface PresenceTargets {
  // The marketplace/relay base (cloud sink) — null when no relay configured.
  relayUrl: string | null;
  // The cached NAS Direct base (local sink) — null when not in Direct mode or
  // no cached partner_local_url.
  directUrl: string | null;
  // The deployment id the beacon is scoped to. The gateway presence endpoint is
  // deployment-scoped (POST .../deployments/{id}/dr/presence); without it there
  // is no valid path to POST to, so a null id suppresses BOTH sinks. The mobile
  // client does not currently hold a deployment id (it pairs by workspace code
  // over relay RPC), so this is null in practice today — see the M2 note on
  // reportPresence. Threaded through so the caller can supply it once available.
  deploymentId: string | null;
  // Bearer for the sink. NOTE: the gateway DR presence route is behind
  // TenantAPIKeyAuth (mp_live_ tenant API key) — a user/session bearer will NOT
  // authenticate against it. See the M2 note on reportPresence.
  authToken: string | null;
}

// Send the beacon to whichever sinks apply right now (§19.4):
//   - relay sink when a relayUrl is configured (the cloud aggregates beacons
//     from clients that still have internet, incl. local-mode/planned-cutover);
//   - direct sink (NAS local registry) when in Direct mode with a cached
//     target — the authoritative source during a true outage.
//
// Contract (confirmed against the gateway): presence lives ONLY at the
// authenticated, tenant-scoped, deployment-scoped path
//   POST /api/v1/tenant/deployments/{id}/dr/presence
// (go-api/cmd/api/main.go ~:712 → RecordPresence). The body is
// {device_id, mode, app_version} with mode ∈ {cloud, local}. There is no flat
// /presence/beacon route on the gateway, and the Aeris2 deployment exposes NO
// presence route at all — so the "NAS direct sink" likewise has no endpoint to
// hit today. Both sinks therefore require a deployment id to build a valid path.
//
// M2 entry-criteria (the real unblock — NOT a path bug):
//   1. The gateway DR presence route is behind TenantAPIKeyAuth (mp_live_),
//      which the mobile client (user/session bearer over relay RPC) does NOT
//      hold. Either (a) add a relay-RPC presence action so the deployment
//      forwards the beacon to the gateway under its own tenant key, or (b) the
//      gateway must accept a user/session-scoped presence beacon. Until one of
//      those exists, a user-bearer POST here will 401.
//   2. The client must learn its deployment id. It pairs by workspace code over
//      relay RPC and holds no deployment id today; thread it in via
//      PresenceTargets.deploymentId once pairing/relay surfaces it.
//
// GATING (preserves Defect-2): a normal cloud-only client makes ZERO requests.
// `targets.relayUrl` is gated upstream in usePresenceBeacon (only non-null when
// DR is actually in use or an operator opts in), AND both sinks are suppressed
// here whenever deploymentId is null — which it always is today. reportPresence
// stays dumb: it POSTs only to fully-formed sinks it is handed.
export async function reportPresence(
  mode: RoutingMode,
  targets: PresenceTargets,
): Promise<void> {
  // No deployment id ⇒ no valid scoped path on either sink ⇒ send nothing.
  // This is the load-bearing zero-request guard for cloud-only clients today.
  if (!targets.deploymentId) return;
  const beacon = await buildBeacon(mode);
  const sinks: Promise<boolean>[] = [];
  if (targets.directUrl) {
    sinks.push(
      postBeacon(
        targets.directUrl,
        targets.deploymentId,
        beacon,
        targets.authToken,
      ),
    );
  }
  if (targets.relayUrl) {
    sinks.push(
      postBeacon(
        targets.relayUrl,
        targets.deploymentId,
        beacon,
        targets.authToken,
      ),
    );
  }
  // Fire-and-forget; never throw.
  await Promise.allSettled(sinks);
}
