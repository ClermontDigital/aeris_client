import {create} from 'zustand';
import StorageService from '../services/StorageService';
import {isLocalUrlSafeForCache, normalizeBaseUrl} from '../constants/config';
import {useSettingsStore} from './settingsStore';
import type {
  CertTrust,
  DrServedPayload,
  LocalUrlCacheStatus,
  RoutingDirective,
} from '../types/dr.types';

// drStore — the client-side NAS Warm-Failover (DR) state for M1.
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md §3.2, §15-M1, §19.
//
// Responsibilities (M1):
//  - Hold the rails-delivered `local_url` (last-known-good) + the §19.1
//    routing directive, ingested from the heartbeat/pairing response.
//  - Validate a freshly-served `local_url` (isLocalUrlSafeForCache) then run
//    the existing testConnection LAN probe (§15-M1) BEFORE committing it as
//    the Direct `baseUrl`. The cloud can never health-check a private address
//    — the client is the only place verification is possible.
//  - Persist last-known-good so the device flips to the cached LAN target with
//    zero rails dependency at outage time. NEVER cleared on absence (§15-B2):
//    a heartbeat that omits `local_url` leaves the cached value intact.
//
// What M1 does NOT do: it does not auto-switch the connection mode (that is
// the §19.2 routing cascade + the cashier prompt) and it does not implement
// SPKI cert-pinning (RN fetch can't yet — see the TODO below, §22.2).

const DR_STORAGE_KEY = 'aeris_dr_state';

// Persisted slice — only the durable last-known-good values survive a cold
// start. Transient probe status / cert-trust are recomputed at runtime.
interface PersistedDrState {
  cachedLocalUrl: string | null;
  // The deployment this local_url belongs to. The cache is per-paired
  // deployment and MUST be flushed on re-pair so a till roaming between shops
  // never fails over to another deployment's NAS (§15-E1). Tracked via the
  // workspace code (the relay routing token) as the pairing identity.
  pairedWorkspaceCode: string | null;
  routingDirective: RoutingDirective;
  lastLocalUrlReportedAt: string | null;
}

interface DrState extends PersistedDrState {
  isLoading: boolean;
  cacheStatus: LocalUrlCacheStatus;
  certTrust: CertTrust;
  // ISO timestamp of the last successful steady-state sync touch (set when a
  // served payload is ingested while reachable). Surfaced as "last-sync" in
  // the §19.3 detail sheet.
  lastSyncAt: string | null;

  // M3-0 — live signals from the dr.routing seam, persisted for M3-B
  // (auto-failback, NEXT AGENT) to consume. NOT durable across cold start (a
  // stale failback signal must never drive a swap on launch) and NOT acted on
  // here — drStore only stores them.
  //   failbackEligible — the deployment says cloud→on-prem failback is safe
  //     (queue drained etc.). M3-B gates its cloud→cloud failback on this.
  //   syncQueueDepth   — NAS→cloud reconcile backlog. M3-B must never failback
  //     mid-drain (depth > 0).
  failbackEligible: boolean;
  syncQueueDepth: number;
  // Whether the last dr.routing call found DR enabled on this deployment.
  // false = no DR surface (404 / dr_enabled=false) → M2 manual path.
  drEnabled: boolean;

  // M3-A — live CONTINUOUS NAS reachability, set by the health-probe loop
  // (useNasHealthProbe) while a NAS target is cached. Replaces the one-time
  // validation's static "cached+ok ⇒ reachable" assumption for the routing
  // cascade. Transient (never persisted — a stale "reachable" must not survive
  // a cold start).
  //   null  — not probed yet this session (cascade treats as reachable, like
  //           cloud's null, so a cold start doesn't read as NAS-down).
  //   true  — last probe reached the NAS.
  //   false — last probe failed → NAS unusable (drives Rule 5 fail-closed via
  //           useFailoverDetection's existing producer path).
  nasProbeReachable: boolean | null;
  // Setter the health-probe loop calls. Kept on the store (not the hook) so
  // the routing cascade reads it without the probe and the cascade fighting
  // over ownership.
  setNasProbeReachable: (v: boolean | null) => void;

  init: () => Promise<void>;
  // M3-0 — fetch the deployment's DR routing state over the relay and feed it
  // through the existing validate→probe→commit pipeline. 404 / dr_enabled=false
  // is a graceful no-op (no DR surface; M2 manual path). Returns true when DR
  // is enabled+served, false otherwise. Safe to call on a cadence post-login.
  pollDrRouting: () => Promise<boolean>;
  // Entry point a response reader calls with whatever DR fields the gateway
  // response carried (partner_local_url / partner_local_url_reported_at /
  // routing_target). Validates + LAN-probes + caches.
  //
  // M2 entry-criteria — NOT yet wired to a live feed (deliberately deferred):
  // the gateway serves partner_local_url + routing_target ONLY on the
  // deployment-server-facing heartbeat RESPONSE (go-api .../deployments/{id}/
  // heartbeat → RegisterHeartbeat ~:916-927), which the Aeris2 deployment
  // receives — NOT the mobile client. The mobile client speaks /api/relay/rpc,
  // whose RelayEnvelope ({status, correlation_id, data, error, duration_ms} —
  // see RelayClient.relayRpcEnvelope) carries NO DR fields. There is therefore
  // no client-side response that currently delivers these keys, so this method
  // is exercised only by drStore.test.ts.
  //
  // To wire end-to-end in M2, pick ONE (both are cross-repo, NOT client-only):
  //   (a) the gateway relays DR fields onto the relay RPC envelope, then the
  //       single call site is RelayClient.relayRpcEnvelope just before the
  //       `return {data, correlationId}` (~:1067): pull envelope.partner_local_url
  //       /routing_target and call useDrStore.getState().ingestServedPayload(
  //       {partner_local_url, partner_local_url_reported_at, routing_target},
  //       this.workspaceCode); OR
  //   (b) Aeris2 exposes a relay action that surfaces its cached DR state to the
  //       client, whose handler calls ingestServedPayload with the same shape.
  // Until (a) or (b) ships, leave this test-only.
  ingestServedPayload: (
    payload: DrServedPayload,
    pairingWorkspaceCode?: string,
  ) => Promise<void>;
  // Flush the cache on re-pair (§15-E1) — call when the workspace code changes.
  flushForRepair: () => Promise<void>;
  // Masked NAS address for the §19.3 detail sheet (don't show the raw host).
  getMaskedLocalUrl: () => string | null;
}

function persist(state: DrState): Promise<void> {
  const slice: PersistedDrState = {
    cachedLocalUrl: state.cachedLocalUrl,
    pairedWorkspaceCode: state.pairedWorkspaceCode,
    routingDirective: state.routingDirective,
    lastLocalUrlReportedAt: state.lastLocalUrlReportedAt,
  };
  return StorageService.setItem(DR_STORAGE_KEY, slice);
}

function coercePersisted(stored: unknown): PersistedDrState {
  const s =
    stored && typeof stored === 'object'
      ? (stored as Record<string, unknown>)
      : {};
  const directive: RoutingDirective =
    s.routingDirective === 'local' ? 'local' : 'cloud';
  return {
    cachedLocalUrl:
      typeof s.cachedLocalUrl === 'string' && s.cachedLocalUrl.length > 0
        ? s.cachedLocalUrl
        : null,
    pairedWorkspaceCode:
      typeof s.pairedWorkspaceCode === 'string' && s.pairedWorkspaceCode.length > 0
        ? s.pairedWorkspaceCode
        : null,
    routingDirective: directive,
    lastLocalUrlReportedAt:
      typeof s.lastLocalUrlReportedAt === 'string'
        ? s.lastLocalUrlReportedAt
        : null,
  };
}

// Mask the host so the detail sheet (and any log) never carries the raw
// internal address (§15-1 data-minimization mirror on the client). Keeps the
// scheme + a hint of the host so an operator can still recognise it.
function maskUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname;
    let maskedHost: string;
    if (host.length <= 4) {
      maskedHost = '•'.repeat(host.length);
    } else {
      maskedHost = `${host.slice(0, 2)}•••${host.slice(-2)}`;
    }
    return `${u.protocol}//${maskedHost}${u.port ? `:${u.port}` : ''}`;
  } catch {
    return '•••';
  }
}

export const useDrStore = create<DrState>((set, get) => ({
  cachedLocalUrl: null,
  pairedWorkspaceCode: null,
  routingDirective: 'cloud',
  lastLocalUrlReportedAt: null,
  isLoading: true,
  cacheStatus: 'pending',
  certTrust: 'unknown',
  lastSyncAt: null,
  failbackEligible: false,
  syncQueueDepth: 0,
  drEnabled: false,
  nasProbeReachable: null,

  setNasProbeReachable: (v: boolean | null) => set({nasProbeReachable: v}),

  init: async () => {
    try {
      const stored = await StorageService.getItem<unknown>(DR_STORAGE_KEY);
      if (stored !== null && stored !== undefined) {
        const slice = coercePersisted(stored);
        set({
          ...slice,
          cacheStatus: slice.cachedLocalUrl ? 'ok' : 'pending',
        });
      }
    } finally {
      set({isLoading: false});
    }
  },

  pollDrRouting: async () => {
    // Lazy require to avoid the ApiClient↔drStore module-load cycle (ApiClient
    // imports drStore at top for the M-R3 mismatch guard).
    const ApiClient = require('../services/ApiClient').default as {
      getDrRouting: () => Promise<{
        dr_enabled: boolean;
        routing_target: 'cloud' | 'local';
        partner_local_url: string | null;
        partner_local_url_reported_at: string | null;
        failback_eligible: boolean;
        sync_queue_depth: number;
      } | null>;
    };

    let routing;
    try {
      routing = await ApiClient.getDrRouting();
    } catch {
      // Transport/auth error on the relay — leave last-known-good untouched
      // (absence-is-not-a-clear) and report "no DR served this cycle". The
      // cloud-reachability signal is driven separately by relay traffic.
      return false;
    }

    // 404 / dr_enabled=false → no DR surface on this deployment. Mark
    // drEnabled=false so the UI/orchestrator know to use the M2 manual path.
    // Per §15-B2 we do NOT clear cachedLocalUrl on absence.
    if (routing === null) {
      set({drEnabled: false});
      return false;
    }

    set({drEnabled: true});
    // Feed the served fields through the EXISTING validate→probe→commit
    // pipeline. partner_local_url is validated (isLocalUrlSafeForCache) +
    // LAN-probed before it can become the Direct baseUrl.
    await get().ingestServedPayload({
      partner_local_url: routing.partner_local_url,
      partner_local_url_reported_at: routing.partner_local_url_reported_at,
      routing_target: routing.routing_target,
      failback_eligible: routing.failback_eligible,
      sync_queue_depth: routing.sync_queue_depth,
    });
    return true;
  },

  ingestServedPayload: async (payload, pairingWorkspaceCode) => {
    // The pairing identity for the cache. Fall back to the configured
    // workspace code so a payload without an explicit one still scopes
    // correctly (§15-E1 per-paired-deployment cache).
    const workspaceCode =
      pairingWorkspaceCode ??
      useSettingsStore.getState().settings.workspaceCode ??
      null;

    // Re-pair guard (§15-E1): if the cached value belongs to a DIFFERENT
    // workspace, flush first so we never fail over to another deployment's NAS.
    const current = get();
    if (
      workspaceCode &&
      current.pairedWorkspaceCode &&
      current.pairedWorkspaceCode !== workspaceCode
    ) {
      await get().flushForRepair();
    }

    // The §19.1 routing directive rides alongside local_url. Unknown/absent
    // → leave the existing directive untouched (don't reset to cloud on a
    // payload that simply didn't carry it).
    if (payload.routing_target === 'cloud' || payload.routing_target === 'local') {
      set({routingDirective: payload.routing_target});
    }

    // M3-0 — persist the M3-B (auto-failback) signals when present. Captured on
    // every ingest regardless of local_url presence. NOT acted on here.
    if (typeof payload.failback_eligible === 'boolean') {
      set({failbackEligible: payload.failback_eligible});
    }
    if (
      typeof payload.sync_queue_depth === 'number' &&
      Number.isFinite(payload.sync_queue_depth)
    ) {
      set({syncQueueDepth: payload.sync_queue_depth});
    }

    const served = payload.partner_local_url;
    // ABSENCE IS NOT A CLEAR (§15-B2 / §3.2): a heartbeat that omits
    // partner_local_url leaves last-known-good intact. Only a present value
    // triggers re-cache.
    if (served == null || served === '') {
      // Still a steady-state touch — record sync time + persist directive.
      set({lastSyncAt: new Date().toISOString()});
      await persist(get());
      return;
    }

    const normalized = normalizeBaseUrl(served);

    // Step 1 — validate (§15-2 / §22.5 Q6). Mirror the gateway ingest check:
    // reject anything that isn't https + private/.local, incl. loopback +
    // Docker bridge. A poisoned address must never become the re-auth target.
    if (!isLocalUrlSafeForCache(normalized)) {
      set({cacheStatus: 'unsafe', certTrust: 'unknown'});
      // Do NOT touch cachedLocalUrl — keep the last-known-good if we had one.
      return;
    }

    // Step 2 — LAN probe (§15-M1). The cloud can't reach a private address;
    // the client must verify reachability on the deployment LAN before committing.
    // We reuse the existing settings-store testConnection probe.
    //
    // TODO(DR-M1, §22.2/§22.5 Q7): testConnection is a liveness-only probe.
    // The DR-cache path MUST additionally verify the served host's TLS
    // identity — SAN match + SPKI-pin to the LE intermediate (§22.2) — because
    // a liveness-only probe against a SPOOFED host is exactly the §15-2
    // credential-harvest primitive. RN's `fetch` does not expose the peer
    // cert, and `react-native-ssl-pinning` bypasses fetch (losing the refresh/
    // timeout wiring) and is unmaintained (§21). Until a native pinning module
    // lands, certTrust stays 'unverified' and the §19.3 detail sheet + Direct
    // re-login screen MUST surface that the cert identity is NOT yet proven so
    // the operator can see a redirect to an unpinned host rather than have it
    // happen silently. FAIL-CLOSED on an explicit 'mismatch' is wired in the
    // routing cascade (§19.2 rule 5) for when pinning exists.
    const probe = useSettingsStore.getState().testConnection;
    const reachable = await probe(normalized);
    if (!reachable) {
      set({cacheStatus: 'unreachable'});
      // Keep the prior last-known-good; a transient probe miss shouldn't drop
      // a previously-good cached address.
      return;
    }

    // Step 3 — commit as last-known-good. This becomes the Direct baseUrl the
    // device fails over to. We do NOT switch connectionMode here (that is the
    // §19.2 cascade + the cashier prompt); we only stage the target.
    const now = new Date().toISOString();
    // Prefer the gateway-stamped reported-at (partner_local_url_reported_at)
    // when it carries one, so the "last-sync" detail reflects when the NAS
    // actually self-reported its address — falling back to now otherwise.
    const reportedAt =
      typeof payload.partner_local_url_reported_at === 'string' &&
      payload.partner_local_url_reported_at.length > 0
        ? payload.partner_local_url_reported_at
        : now;
    set({
      cachedLocalUrl: normalized,
      pairedWorkspaceCode: workspaceCode,
      lastLocalUrlReportedAt: reportedAt,
      lastSyncAt: now,
      cacheStatus: 'ok',
      // Best-effort until native pinning exists (see TODO above).
      certTrust: 'unverified',
    });
    await persist(get());
  },

  flushForRepair: async () => {
    set({
      cachedLocalUrl: null,
      pairedWorkspaceCode: null,
      routingDirective: 'cloud',
      lastLocalUrlReportedAt: null,
      cacheStatus: 'pending',
      certTrust: 'unknown',
      // M3-A — drop the live probe verdict + M3-B signals on re-pair so a
      // roaming till never carries another deployment's NAS health/failback.
      nasProbeReachable: null,
      failbackEligible: false,
      syncQueueDepth: 0,
    });
    // M3-C — a roaming till re-pairing to a DIFFERENT deployment must not carry
    // another shop's cached silent-re-auth credential. Wipe it on re-pair
    // (per-workspace scope is also enforced at load-time, but wiping here keeps
    // the Keychain clean). Lazy-require to avoid a static cycle.
    try {
      const {
        SilentReauthCredentialStore,
      } = require('../services/SilentReauthCredentialStore') as typeof import('../services/SilentReauthCredentialStore');
      await SilentReauthCredentialStore.clear();
    } catch {
      // Best-effort — never block the re-pair flush.
    }
    await persist(get());
  },

  getMaskedLocalUrl: () => maskUrl(get().cachedLocalUrl),
}));
