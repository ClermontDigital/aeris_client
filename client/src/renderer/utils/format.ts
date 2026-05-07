// Light-weight formatters. Intentionally not pulled from @aeris/shared
// because the renderer keeps to type-only imports there. These exist
// in mobile/src/utils/format.ts; ported verbatim minus the haptic hook
// dependency.

export function formatCents(cents: number, currency = 'AUD'): string {
  const value = (cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

export function formatNumber(n: number): string {
  try {
    return new Intl.NumberFormat().format(n);
  } catch {
    return String(n);
  }
}

export function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}
