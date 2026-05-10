// Cross-domain wire-shape helpers used by every normalizer.

// Aeris2's controllers wrap single-resource responses in `{data: {...}}` via
// Laravel's API Resource convention. The relay envelope unwraps to expose
// that body verbatim, so callers see `{data: {...}}` instead of the bare
// resource. Detail screens that read `raw.id`/`raw.name`/etc. would render
// empty fields without this. Lists are not affected — paginated bodies are
// `{data: [...], meta}` and the call sites already index into `.data`.
export function unwrapResource<T = unknown>(result: unknown): T {
  if (
    result &&
    typeof result === 'object' &&
    !Array.isArray(result) &&
    'data' in result
  ) {
    const inner = (result as {data: unknown}).data;
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      return inner as T;
    }
  }
  return result as T;
}

// Aeris2's controllers wrap list responses in `{data: [...]}` (Laravel
// convention). The relay envelope unwrap propagates the body as-is when no
// inner status is present, so callers see the wrapper. Unwrap defensively —
// accept either bare arrays (future / direct controllers) or the wrapper.
export function unwrapList<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'data' in result) {
    const data = (result as {data: unknown}).data;
    if (Array.isArray(data)) return data as T[];
  }
  return [];
}

export function formatCentsString(c: number | undefined): string {
  if (c === undefined || !Number.isFinite(c)) return '';
  return '$' + (c / 100).toFixed(2);
}

export function pickString(
  source: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const v = source[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return '';
}

export function pickStringOrNull(
  source: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const v = source[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return null;
}

export function pickIntOrNull(
  source: Record<string, unknown>,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const v = source[key];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === 'string' && v.trim() !== '') {
      const parsed = parseInt(v, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

// Aeris2 may emit either dollars (`total_amount`) or cents (`total_cents`);
// prefer cents when present, else the first present-and-valid dollar key.
// First-valid-wins preserves a legitimate $0 (refund / promo line) instead
// of falling through to a wrong key.
export function findCents(
  source: Record<string, unknown>,
  centsKey: string,
  ...dollarKeys: string[]
): number | undefined {
  const cents = source[centsKey];
  if (typeof cents === 'number' && Number.isFinite(cents)) {
    return Math.round(cents);
  }
  if (typeof cents === 'string' && cents.trim() !== '') {
    const parsed = parseFloat(cents);
    if (Number.isFinite(parsed)) return Math.round(parsed);
  }
  for (const key of dollarKeys) {
    const dollars = source[key];
    if (typeof dollars === 'number' && Number.isFinite(dollars)) {
      return Math.round(dollars * 100);
    }
    if (typeof dollars === 'string' && dollars.trim() !== '') {
      const parsed = parseFloat(dollars);
      if (Number.isFinite(parsed)) return Math.round(parsed * 100);
    }
  }
  return undefined;
}

// pickCents defaults missing to 0; pickCentsOrNull defaults missing to null
// (used for permission-gated fields like cost_cents where absent ≠ free).
export function pickCents(
  source: Record<string, unknown>,
  centsKey: string,
  ...dollarKeys: string[]
): number {
  return findCents(source, centsKey, ...dollarKeys) ?? 0;
}

export function pickCentsOrNull(
  source: Record<string, unknown>,
  centsKey: string,
  ...dollarKeys: string[]
): number | null {
  return findCents(source, centsKey, ...dollarKeys) ?? null;
}

export function asNumber(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const parsed = parseFloat(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
