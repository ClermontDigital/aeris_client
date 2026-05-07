import { useEffect, useState } from 'react';

// Returns a value that lags `value` by `delayMs`. Useful for live-search
// inputs so you don't fire a relay call on every keystroke.
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
