// Format an integer cents value as a display string. e.g. 1234 → "$12.34".
//
// Centralized so every screen renders currency identically — pre-refactor
// each screen had its own inline copy and a stray rounding/locale tweak in
// one place would drift the whole app's totals out of agreement with the
// receipt printer's text.
export function formatCurrency(cents: number): string {
  return '$' + (cents / 100).toFixed(2);
}
