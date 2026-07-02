// T10 - Bulk-status reconciliation helper.
//
// PURPOSE
// The server-side bulk-status endpoint (PATCH /api/v1/repairs/bulk/status)
// can silently skip repairs that are non-transitionable (already `completed`,
// `cancelled`, or otherwise ineligible) and returns a `{succeeded, skipped}`
// summary. RelayClient.bulkUpdateRepairStatus + DirectClient.bulkUpdateRepairStatus
// already reconcile four server response shapes into a canonical summary
// (see shared/src/relay/RelayClient.ts bulkUpdateRepairStatus); this helper
// takes that canonical summary and produces the human-readable toast/banner
// message.
//
// FUTURE CONSUMER
// There is currently NO screen calling bulkUpdateRepairStatus - the intended
// consumer is a not-yet-shipped BulkStatusScreen (batch status change from
// the repairs list). When that screen ships, it should:
//   1. Call ApiClient.bulkUpdateRepairStatus(ids, status, notes).
//   2. Pass the returned {succeeded, skipped} into reconcileBulkStatusResult
//      alongside the original `ids` array (the "requested" set).
//   3. Show the returned `message` via a Toast/Alert, styling by `kind`.
//   4. Additionally surface the caveat toasts documented at the bottom of
//      this file (stock-not-decremented, notifications-may-not-fire,
//      non-transitionable silent no-op) since none of them are distinguishable
//      from the diff alone.
//
// PURITY
// This module is intentionally pure - no React, no Alert, no side effects -
// so it can be exhaustively unit-tested without any UI mount.

export type BulkStatusReconciliation = {
  message: string;
  kind: 'success' | 'partial' | 'error';
};

// Aligned with the rich server shape confirmed by the deployment team
// (DR-M3): `succeeded` is a bare id list; `skipped` + `failed` come back as
// `[{id, reason}]` on the wire and are flattened by RelayClient /
// DirectClient into id-only arrays plus a `reasons` map. Reasons are
// preserved so this helper can name them in the toast copy — e.g. "3 skipped:
// 2 already completed, 1 invalid transition." Legacy shapes still produce a
// `succeeded`/`skipped` pair without `failed` or `reasons`; both are
// optional so callers on the old contract keep compiling.
export type BulkStatusResult = {
  succeeded: number[];
  skipped: number[];
  failed?: number[];
  reasons?: Record<number, string>;
};

// Reconcile a bulk-status server response against the requested id list and
// produce a human-readable summary + toast kind.
//
// Rules (spec-aligned):
//   - requested.length === succeeded.length -> full success
//   - succeeded.length > 0 AND (skipped.length > 0 OR failed.length > 0) ->
//     partial success. Reasons (when present) are surfaced in the toast copy.
//   - succeeded.length === 0 -> error (nothing changed). Reasons are named
//     in the toast so the operator knows WHY.
//   - requested.length === 0 (edge) -> error, treated as "nothing to do"
export function reconcileBulkStatusResult(
  requested: number[],
  result: BulkStatusResult,
): BulkStatusReconciliation {
  const requestedCount = requested.length;
  const succeededCount = result.succeeded.length;
  const skippedCount = result.skipped.length;
  const failedCount = (result.failed ?? []).length;
  const nonSuccessCount = skippedCount + failedCount;

  // Edge case: nothing was requested. Not really an error the user caused,
  // but there is no positive outcome to announce - treat as error so a
  // caller that shows a red toast doesn't lie about a successful update.
  if (requestedCount === 0) {
    return {
      message: 'No repairs were selected.',
      kind: 'error',
    };
  }

  // Full success - every requested id came back in `succeeded`.
  if (succeededCount === requestedCount) {
    const noun = succeededCount === 1 ? 'repair' : 'repairs';
    return {
      message: `Updated ${succeededCount} ${noun}.`,
      kind: 'success',
    };
  }

  // Partial success - some updated, some not.
  if (succeededCount > 0 && nonSuccessCount > 0) {
    const suffix = summariseReasons(result);
    // Combined skipped + failed count reads clearer to the operator than
    // splitting them into two figures.
    return {
      message:
        `${succeededCount} of ${requestedCount} repairs updated, ` +
        `${nonSuccessCount} skipped${suffix}.`,
      kind: 'partial',
    };
  }

  // Nothing updated. Either all skipped/failed or the server acked with an
  // empty succeeded list. Both read the same to the operator - the batch
  // failed to move any repairs into the target status.
  const suffix = summariseReasons(result);
  return {
    message: suffix
      ? `No repairs were updated${suffix}.`
      : 'No repairs were updated.',
    kind: 'error',
  };
}

// Roll the per-id reasons up into a short "N reason-a, M reason-b" suffix.
// Returns "" when reasons aren't populated so the caller can plain-concat.
// Reason strings are truncated (max 3 distinct reasons named; the rest are
// bundled as "other") so a giant reason set doesn't blow up the toast.
function summariseReasons(result: BulkStatusResult): string {
  const reasons = result.reasons;
  if (!reasons || Object.keys(reasons).length === 0) return '';
  const counts = new Map<string, number>();
  for (const id of [...result.skipped, ...(result.failed ?? [])]) {
    const reason = reasons[id];
    if (!reason) continue;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  if (counts.size === 0) return '';
  const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const named = entries.slice(0, 3).map(([reason, count]) => `${count} ${reason}`);
  if (entries.length > 3) {
    const otherCount = entries
      .slice(3)
      .reduce((sum, [, count]) => sum + count, 0);
    named.push(`${otherCount} other`);
  }
  return ` (${named.join(', ')})`;
}

// ---------------------------------------------------------------------------
// CAVEAT TOASTS - documented here so the future BulkStatusScreen surfaces
// them consistently. NONE of these are distinguishable from the server
// response alone; they are side-channel warnings that must fire whenever
// the bulk endpoint is invoked with the relevant target status.
// ---------------------------------------------------------------------------
//
// 1. NON-TRANSITIONABLE SILENT NO-OP
//    Server silently skips ids that are not in a transitionable state (already
//    `completed`, `cancelled`, etc.). Skipped ids come back with no reason.
//    When `skipped.length > 0`, surface:
//      "N repairs were skipped. They may already be in the target status or
//       cannot be transitioned."
//
// 2. STOCK NOT DECREMENTED
//    Bulk-status does NOT run the completion side-effects (inventory decrement,
//    invoice mint) that the single-status endpoint runs. When bulk-transitioning
//    INTO `completed` or `ready`, surface:
//      "Bulk status changes do not decrement stock or generate invoices.
//       Reconcile inventory manually."
//
// 3. SYNC NOTIFICATION UNCERTAINTY
//    Server may or may not fire customer SMS/email notifications on bulk
//    transitions (unlike the single-status endpoint which always fires).
//    Surface:
//      "Customer notifications may not fire for bulk updates. Verify send
//       status per repair."
//
// See RelayClient.bulkUpdateRepairStatus documentation block for the wire-
// contract instability that necessitates these caveats.
