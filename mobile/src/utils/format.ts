// Format an integer cents value as a display string. e.g. 1234 → "$12.34".
//
// Centralized so every screen renders currency identically — pre-refactor
// each screen had its own inline copy and a stray rounding/locale tweak in
// one place would drift the whole app's totals out of agreement with the
// receipt printer's text.
export function formatCurrency(cents: number): string {
  return '$' + (cents / 100).toFixed(2);
}

// Whole-dollar variant for stat cards / aggregates where the decimals are
// visual noise that crowds the column on narrow iPhones. Rounds half-away-
// from-zero (e.g. 1499 cents → "$15"). Use formatCurrency() anywhere the
// exact dollars-and-cents value matters (line totals, receipts).
export function formatCurrencyWhole(cents: number): string {
  return '$' + Math.round(cents / 100).toLocaleString('en-US');
}
