// NAS Warm-Failover (DR) client types — M1 foundations.
// Source of truth: docs/PROJECT_DR_NAS_WARM_FAILOVER.md (§3.1/§3.2, §19).

// The marketplace-served per-deployment routing directive (§19.1). Clients
// pick it up on their next poll (relay mode) and act on it in the routing
// cascade (§19.2 rule 2). `cloud` = normal; `local` = operator-driven planned
// cutover to the NAS. Absent/unknown is treated as `cloud`.
export type RoutingDirective = 'cloud' | 'local';

// The authority the device is currently selling against (§19.3 indicator).
//   cloud     — ☁️  normal: relay/cloud is the writer.
//   local     — 🏪  In-store: Direct/LAN against the NAS (sub-reason below).
//   switching — 🔄  mid mode-switch (re-auth / probe in flight).
//   offline   — 🔴  degraded: neither cloud nor a valid NAS reachable.
export type RoutingMode = 'cloud' | 'local' | 'switching' | 'offline';

// Why the device is in `local` mode — drives the §19.3 sub-reason copy.
//   planned          — operator directive=local (§19.1 cutover).
//   cloud-unreachable — outage failover the cashier confirmed (§19.2 rule 4).
export type LocalModeReason = 'planned' | 'cloud-unreachable' | null;

// Outcome of the §15-M1 validate-on-cache step for a served `local_url`.
//   pending   — not yet probed this session.
//   ok        — validated + LAN-probed + cached as last-known-good baseUrl.
//   unsafe    — failed isLocalUrlSafeForCache (rejected, not cached).
//   unreachable — passed validation but the LAN probe failed (not committed).
export type LocalUrlCacheStatus = 'pending' | 'ok' | 'unsafe' | 'unreachable';

// What the served payload (gateway heartbeat/poll/pairing response — §3.2/§14.7
// Q8) carries for DR. The gateway serves the DR partner's (NAS) validated LAN
// address as `partner_local_url` (with `partner_local_url_reported_at`),
// resolved from this deployment's dr_partner_deployment_id — see
// go-api/internal/handlers/tenant/deployments.go RegisterHeartbeat (~:916-927).
// `routing_target` is the §19.1 directive. All optional and unknown-key-
// tolerant: a non-DR deployment omits them and the client leaves last-known-
// good untouched (never clear on absence — §15-B2/§3.2).
export interface DrServedPayload {
  partner_local_url?: string | null;
  partner_local_url_reported_at?: string | null;
  routing_target?: RoutingDirective | null;
  // M3-0 — carried by the dr.routing seam for M3-B (auto-failback, next agent)
  // to consume. drStore PERSISTS these; it does NOT act on them (no failback
  // logic here). Absent on the legacy test-only paths → left untouched.
  failback_eligible?: boolean | null;
  sync_queue_depth?: number | null;
}

// Cert-trust posture for the cached Direct endpoint (§18 / §22.5 Q7). Until
// SPKI-pinning is implemented in RN fetch (it is NOT today — see the TODO in
// drStore.validateAndCacheLocalUrl referencing §22.2), this is best-effort:
//   unknown   — not yet evaluated.
//   trusted   — SAN/pin verified (target state).
//   unverified — reachable but cert identity NOT proven (current RN reality).
//   mismatch  — cert identity check failed → FAIL CLOSED (§19.2 rule 5).
export type CertTrust = 'unknown' | 'trusted' | 'unverified' | 'mismatch';
