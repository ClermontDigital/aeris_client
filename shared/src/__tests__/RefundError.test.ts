import {RefundError, classifyRefundError} from '../relay/RefundError';

describe('RefundError', () => {
  it('exposes message + kind + status + correlationId', () => {
    const err = new RefundError('nope', 'rejected', 422, 'cid-123');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('RefundError');
    expect(err.message).toBe('nope');
    expect(err.kind).toBe('rejected');
    expect(err.status).toBe(422);
    expect(err.correlationId).toBe('cid-123');
  });

  it('defaults status and correlationId to null', () => {
    const err = new RefundError('m', 'unknown');
    expect(err.status).toBeNull();
    expect(err.correlationId).toBeNull();
  });
});

describe('classifyRefundError', () => {
  // Status-based classification — direct mode supplies HTTP status.
  it('maps 403 to forbidden', () => {
    expect(classifyRefundError('You do not have access to this sale.', 403)).toBe('forbidden');
  });

  it('maps 409 to conflict', () => {
    expect(
      classifyRefundError('Idempotency key reused with a different request body.', 409),
    ).toBe('conflict');
  });

  it('maps 422 to rejected', () => {
    expect(
      classifyRefundError('This sale has already been fully refunded.', 422),
    ).toBe('rejected');
  });

  it('maps 429 to rate_limited', () => {
    expect(classifyRefundError('Too many requests', 429)).toBe('rate_limited');
  });

  // Message-pattern classification — relay mode has no status to lean on.
  it('falls back to message matching when status is null', () => {
    expect(classifyRefundError('You do not have access to this sale.')).toBe('forbidden');
    expect(
      classifyRefundError('Idempotency key reused with a different request body.'),
    ).toBe('conflict');
    expect(classifyRefundError('This sale has already been fully refunded.')).toBe('rejected');
    expect(
      classifyRefundError('Refund amount exceeds maximum refundable amount of $25.00'),
    ).toBe('rejected');
    expect(
      classifyRefundError('Refund would exceed original quantity for one or more items.'),
    ).toBe('rejected');
    expect(
      classifyRefundError('One or more items do not belong to this sale.'),
    ).toBe('rejected');
    expect(classifyRefundError('Refund could not be processed.')).toBe('rejected');
  });

  it('returns unknown for unrecognised messages without status', () => {
    expect(classifyRefundError('something weird')).toBe('unknown');
    expect(classifyRefundError('')).toBe('unknown');
  });

  // Status wins over message — the direct-mode HTTP status is authoritative
  // because the server controls it. If the message happens to look like a
  // different kind (e.g. validation copy returned under a 403), the status
  // still drives the UI branch.
  it('lets status override a misleading message', () => {
    expect(
      classifyRefundError(
        'Refund amount exceeds maximum refundable amount of $25.00',
        403,
      ),
    ).toBe('forbidden');
    expect(
      classifyRefundError('You do not have access to this sale.', 422),
    ).toBe('rejected');
    expect(classifyRefundError('Idempotency key reused.', 429)).toBe(
      'rate_limited',
    );
  });
});
