// DR M3 — per-endpoint webview partition model (desktop v1).
//
// OWNER DECISION (replaces the old "clear ALL partitions on every switch"
// re-auth guarantee at main.js:894-912 / ipc-handlers.js:487-506):
//
//   CLOUD and NAS get SEPARATE persistent webview partitions. Each endpoint
//   retains its OWN login. On a switch (manual OR auto) we load the TARGET
//   endpoint's partition: if it has a warm session the cashier keeps selling
//   with no prompt; if not, they get that endpoint's login screen. This is what
//   makes auto-failover usable during an outage — a cashier who has already
//   signed into the in-store NAS keeps trading the instant the cloud drops,
//   instead of being thrown to a login wall mid-rush.
//
//   The original model cleared every partition's cookies/localStorage on each
//   switch so the user ALWAYS re-authenticated against the new target. The new
//   model trades that blanket re-auth for endpoint-scoped persistence.
//
// SECURITY NOTE (the change must be documented + enforced):
//   - ISOLATION: cloud and NAS sessions live in DIFFERENT partitions, so a
//     cloud session can NEVER leak into the NAS view or vice-versa. Cookies,
//     localStorage, IndexedDB, service workers and cache are per-partition in
//     Electron — switching mode swaps the whole storage namespace.
//   - EXPLICIT LOGOUT still clears. A user-initiated logout must wipe the
//     relevant partition(s) (see clearPartitionsForLogout / the existing
//     set-routing-mode 'clear' path retained for logout) so a shared till does
//     not leave a warm session behind. Per-endpoint persistence is for FAILOVER
//     CONTINUITY, not for skipping logout hygiene.
//   - A poisoned localUrl is still rejected up-front by dr-url-validator before
//     any NAS partition is ever loaded, so isolation can't be used to harvest
//     credentials against an attacker host.
//
// FLAG INTERACTION: the per-endpoint partition NAMES are deterministic and
// flag-independent (they must be, so a manual switch is also correct), but the
// AUTO-SWAP that exercises them is gated on `drAutoFailover`. With the flag off,
// nothing auto-switches; a manual switch still resolves the correct partition
// here, and flag-off behaviour stays safe + re-auth-correct because the cashier
// only reaches a partition by an explicit, confirmed manual toggle.

// Resolve the persistent partition name for a given routing mode + optional
// per-cashier session id. Mirrors the legacy naming so existing warm sessions
// in `persist:main` / `persist:user-${id}` are not silently orphaned for the
// CLOUD endpoint (cloud is the historical default).
//
//   mode 'cloud', no session  -> 'persist:cloud'
//   mode 'cloud', session id   -> 'persist:cloud:user-${id}'
//   mode 'local', no session  -> 'persist:nas'
//   mode 'local', session id   -> 'persist:nas:user-${id}'
//
// `sessionId` is null/undefined when multi-user session management is disabled
// (single shared till), giving the base per-endpoint partition.
function partitionFor(mode, sessionId) {
  const endpoint = mode === 'local' ? 'nas' : 'cloud';
  if (sessionId === null || sessionId === undefined || sessionId === '') {
    return `persist:${endpoint}`;
  }
  return `persist:${endpoint}:user-${sessionId}`;
}

// Every partition that belongs to ONE endpoint (mode), across all cashiers.
// Used by an explicit LOGOUT to clear just the endpoint the cashier is logging
// out of (isolation: logging out of NAS must not wipe the cloud session, and
// vice-versa). `sessionIds` is the list of per-cashier session ids (empty when
// session management is off).
function partitionsForEndpoint(mode, sessionIds = []) {
  const out = [partitionFor(mode, null)];
  for (const id of sessionIds) {
    out.push(partitionFor(mode, id));
  }
  return out;
}

// Both endpoints' partitions for a given cashier set — used by a full/global
// logout that must clear cloud AND NAS (e.g. a "sign out everywhere" / till
// handover).
function allPartitions(sessionIds = []) {
  return [
    ...partitionsForEndpoint('cloud', sessionIds),
    ...partitionsForEndpoint('local', sessionIds),
  ];
}

module.exports = { partitionFor, partitionsForEndpoint, allPartitions };
