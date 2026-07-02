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

export type BulkStatusResult = {
  succeeded: number[];
  skipped: number[];
};

// Reconcile a bulk-status server response against the requested id list and
// produce a human-readable summary + toast kind.
//
// Rules (spec-aligned):
//   - requested.length === succeeded.length -> full success
//   - succeeded.length > 0 AND skipped.length > 0 -> partial success
//   - succeeded.length === 0 -> error (nothing changed)
//   - requested.length === 0 (edge) -> error, treated as "nothing to do"
export function reconcileBulkStatusResult(
  requested: number[],
  result: BulkStatusResult,
): BulkStatusReconciliation {
  const requestedCount = requested.length;
  const succeededCount = result.succeeded.length;
  const skippedCount = result.skipped.length;

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

  // Partial success - some updated, some skipped.
  if (succeededCount > 0 && skippedCount > 0) {
    return {
      message: `${succeededCount} of ${requestedCount} repairs updated, ${skippedCount} skipped.`,
      kind: 'partial',
    };
  }

  // Nothing updated. Either all skipped or the server acked with an empty
  // succeeded list. Both read the same to the operator - the batch failed
  // to move any repairs into the target status.
  return {
    message: 'No repairs were updated.',
    kind: 'error',
  };
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
