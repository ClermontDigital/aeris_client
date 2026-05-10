import { useCallback, useEffect, useRef, useState } from 'react';
import { relayCall } from '../services/relay';
import type { RelayCallOptions, RelayErrorCode } from '../../shared-types/ipc';

export interface UseRelayQueryResult<T> {
  data: T | null;
  loading: boolean;
  // The error code from main's relay bridge. UNAUTHORIZED is intentionally
  // not surfaced here — main's authManager handles 401 separately by
  // wiping the session, so screens never need to render an
  // "unauthorized" banner.
  errorCode: RelayErrorCode | null;
  errorMessage: string | null;
  refetch: () => Promise<void>;
}

// Hand-rolled query hook for v1. The plan calls out TanStack Query as a
// future option. For Phase 3 we only need: fire on mount, refetch on
// demand, and refetch when the window regains focus. Keep it simple.
export function useRelayQuery<T>(
  action: string,
  params: unknown = {},
  options?: RelayCallOptions & { refetchOnFocus?: boolean },
): UseRelayQueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorCode, setErrorCode] = useState<RelayErrorCode | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Stabilise options dependency — JSON-stringify so nested objects don't
  // make this hook fire every render. This matches mobile's pattern.
  const paramsKey = JSON.stringify(params ?? {});
  const idemKey = options?.idempotencyKey;

  // Sequence-id guards against stale-response races: when action/params
  // change mid-fetch, we increment the seq, capture it, and ignore any
  // response whose seq no longer matches. We deliberately avoid the old
  // `mountedRef` pattern — React 18 StrictMode breaks `useRef(true)`
  // early-returns by leaving the ref `false` after the synthetic
  // cleanup, leaving screens stuck on their loading spinner.
  const seqRef = useRef(0);

  const fetcher = useCallback(async () => {
    const mySeq = ++seqRef.current;
    setLoading(true);
    let result;
    try {
      result = await relayCall<T>(
        action,
        JSON.parse(paramsKey),
        idemKey ? { idempotencyKey: idemKey } : undefined,
      );
    } catch (e) {
      // IPC-layer rejection (frame guard etc.) — translate to UNKNOWN
      // so screens don't hang on `loading: true`.
      result = {
        ok: false as const,
        code: 'UNKNOWN' as const,
        message: (e as Error)?.message ?? 'IPC call failed',
      };
    }
    if (mySeq !== seqRef.current) return;
    if (result.ok) {
      setData(result.data);
      setErrorCode(null);
      setErrorMessage(null);
    } else {
      setErrorCode(result.code);
      setErrorMessage(result.message);
    }
    setLoading(false);
  }, [action, paramsKey, idemKey]);

  useEffect(() => {
    void fetcher();
  }, [fetcher]);

  // Refetch on window focus — mirrors mobile's useFocusEffect.
  const refetchOnFocus = options?.refetchOnFocus ?? true;
  useEffect(() => {
    if (!refetchOnFocus) return;
    const onFocus = () => void fetcher();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetcher, refetchOnFocus]);

  return {
    data,
    loading,
    errorCode,
    errorMessage,
    refetch: fetcher,
  };
}
