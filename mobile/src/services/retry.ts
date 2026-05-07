import type {ConnectionMode} from '../types/api.types';

export class RelayError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly correlationId: string | null,
    public readonly action: string,
  ) {
    super(message);
    this.name = 'RelayError';
  }
}

// Default retry policy for idempotent POSTs. Three attempts is enough to ride
// out a brief network blip or relay restart without keeping the cashier
// waiting longer than ~6s in the worst case (with jitter).
export const SALE_RETRY = {maxAttempts: 3, baseDelayMs: 500} as const;

// One bonus attempt for idempotent reads — long enough to ride out a single
// transient 502/504 without making the user wait through a full sale-style
// backoff if the server is genuinely down.
export const READ_RETRY = {maxAttempts: 2, baseDelayMs: 400} as const;

export function isRetryable(err: unknown): boolean {
  if (err instanceof RelayError) {
    // Only "timeout" envelopes are safely retryable. Application errors
    // (INSUFFICIENT_STOCK, VALIDATION, etc.) are deterministic — retrying
    // would just produce the same failure with extra latency.
    return err.code === 'TIMEOUT';
  }
  if (err instanceof Error) {
    const status = (err as Error & {status?: number}).status;
    if (status === 408 || status === 429 || status === 504) return true;
    if (status !== undefined && status >= 500 && status < 600) return true;
    if (status !== undefined && status >= 400 && status < 500) return false;
    // A status outside the 4xx/5xx ranges (e.g. 200 with a non-envelope
    // body — see relay HTTP error handling) is not a transport failure;
    // it's a contract violation that retrying won't fix.
    if (status !== undefined) return false;
    // No status set → treat as transport failure (timeout, abort, DNS).
    return true;
  }
  return false;
}

export function backoffDelay(attempt: number, baseMs: number): number {
  // Exponential backoff with full jitter: 1x, 3x, 9x base, ±20%.
  const exp = baseMs * Math.pow(3, attempt - 1);
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.round(exp * jitter);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function withReadRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= READ_RETRY.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt >= READ_RETRY.maxAttempts || !isRetryable(e)) throw e;
      await sleep(backoffDelay(attempt, READ_RETRY.baseDelayMs));
    }
  }
  throw lastError;
}

// Whether an error means "the requested record doesn't exist".
//
// Direct mode: HTTP 404 from the ERP is the canonical "not found".
// Relay mode: HTTP 404 means "no relay_service_config for this service" —
// i.e. the deployment is misconfigured. That MUST surface as an error;
// silently returning null would mask broken deployments as missing records.
// "Record absent" in relay mode comes back as an envelope with
// status=error, error.code=NOT_FOUND.
export function isNotFound(err: unknown, mode: ConnectionMode): boolean {
  if (err instanceof RelayError) {
    return err.code === 'NOT_FOUND' || err.code === 'not_found';
  }
  if (
    mode === 'direct' &&
    err &&
    typeof err === 'object' &&
    'status' in err
  ) {
    return (err as {status?: number}).status === 404;
  }
  return false;
}
