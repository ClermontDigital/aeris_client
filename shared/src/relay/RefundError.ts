// Typed error thrown by RelayClient.refundSale / DirectClient.refundSale when
// the server's controller rejects the refund. The HTTP/relay-envelope layer
// reports success in these cases (HTTP 200, envelope.status: "success") but
// nests `success: false` inside the controller's own response body — so the
// data-layer inspects `data.success` and throws this class so UI can branch
// without parsing free-form messages.
//
// `kind` is best-effort derived from the server's message + (when available)
// the HTTP status. Treat 'unknown' as "show a generic toast"; the raw
// `message` from the server is preserved for cases where you do want to
// show the verbatim string ("Refund amount exceeds maximum refundable
// amount of $25.00" reads better than a generic banner).
export type RefundErrorKind =
  // Token lacks `sales:refund` ability, sale doesn't exist, or sale is at
  // a different location. Server returns one message for all three so the
  // UI shouldn't try to differentiate. HTTP 403 in direct mode.
  | 'forbidden'
  // Server-side validation failure (already fully refunded, exceeds max,
  // bad sale_item_id, bad status, etc). HTTP 422 in direct mode. Surface
  // the verbatim message — it's user-facing copy curated server-side.
  | 'rejected'
  // Idempotency key reused with a different request body. Per the doc,
  // do NOT auto-retry with a new key — bail the user back to the sheet
  // (which re-mints a fresh UUID). HTTP 409 in direct mode.
  | 'conflict'
  // Rate limit on the refund route (10/min/user). UI should back off.
  // HTTP 429 in direct mode.
  | 'rate_limited'
  // Fallback when status + message don't match any known shape.
  | 'unknown';

export class RefundError extends Error {
  constructor(
    message: string,
    public readonly kind: RefundErrorKind,
    public readonly status: number | null = null,
    public readonly correlationId: string | null = null,
  ) {
    super(message);
    this.name = 'RefundError';
  }
}

// Classify a server-side rejection into a RefundErrorKind. Direct mode can
// supply the HTTP status; relay mode only has the controller's message
// string (the envelope's own status is "success" for 4xx-wrapped-in-200).
// Status takes precedence; message-pattern matching is the fallback.
export function classifyRefundError(
  message: string,
  status: number | null = null,
): RefundErrorKind {
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status === 422) return 'rejected';
  if (status === 429) return 'rate_limited';

  const lower = (message || '').toLowerCase();
  if (lower.includes('do not have access')) return 'forbidden';
  if (lower.includes('idempotency key')) return 'conflict';
  if (
    lower.includes('cannot be refunded') ||
    lower.includes('already been fully refunded') ||
    lower.includes('exceed') ||
    lower.includes('do not belong to this sale') ||
    lower.includes('could not be processed')
  ) {
    return 'rejected';
  }
  return 'unknown';
}
