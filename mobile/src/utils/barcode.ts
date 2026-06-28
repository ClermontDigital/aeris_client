// Heuristic for detecting whether a search-bar value is a barcode-style
// string (BT scanner emit) vs a text search (cashier typing a name).
//
// BT HID scanners type the barcode characters into the focused TextInput
// in a rapid burst, then send Enter/CR. We can't distinguish a fast
// burst from manual typing at the JS layer, so we rely on the shape of
// the buffer instead:
//
//   - 6 chars or more (UPC-E is 6; EAN-8 / -13, UPC-A, Code-128 are longer)
//   - no whitespace (barcodes never contain spaces; product searches often do)
//   - alphanumeric + a few safe symbols (hyphen, underscore)
//
// Hits the barcode lookup endpoint optimistically; on miss we just fall
// through to the live text search that was already running via
// onChangeText. Worst-case cost is one extra cheap relay call when the
// user hits Return on a numeric SKU that's also a non-barcode.
export function isLikelyBarcode(value: string): boolean {
  const v = value.trim();
  if (v.length < 6 || v.length > 32) return false;
  return /^[A-Za-z0-9\-_]+$/.test(v);
}
