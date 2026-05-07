import { useCallback, useEffect, useState } from 'react';
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

  // The previous version guarded setState behind a `mountedRef` ref, but
  // React 18 Strict Mode runs cleanup-only useEffects in mount → cleanup
  // → mount cycles where useRef(true) only initialises once. After the
  // first cleanup the ref stays false, so the fetcher's early-return fires
  // even though the component is still alive — leaving the screen stuck
  // on its loading spinner. React 18+ silently ignores setState on
  // unmounted components, so the guard isn't needed for correctness.
  const fetcher = useCallback(async () => {
    setLoading(true);
    const result = await relayCall<T>(
      action,
      JSON.parse(paramsKey),
      idemKey ? { idempotencyKey: idemKey } : undefined,
    );
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
