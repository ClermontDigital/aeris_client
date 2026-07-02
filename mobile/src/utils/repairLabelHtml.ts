/**
 * Repair-label HTML builder — matches web parity for the Dymo 89×38 mm layout
 * that ships from RepairBarcodeModal.tsx on the Aeris2 web app.
 *
 * We can't reuse jsbarcode from RN (no DOM). Instead we ship a compact CODE128B
 * encoder that produces raw SVG so the label print HTML never depends on a
 * WebView script load. This means:
 *   - Works offline (no CDN dependency)
 *   - No race between expo-print's snapshot and jsbarcode's DOM writes
 *   - Same visual output on iOS AirPrint + Android print + share-sheet PDF
 *
 * CODE128B suffices because repair numbers are alphanumeric + hyphens
 * (REP-YYYYMMDD-NNNNNN), all in the printable-ASCII range CODE128B covers
 * (chars 32–127).
 */

// CODE128 pattern table — 107 entries × 11 modules each (each char is 6 bars +
// spaces summing to 11 modules wide). Standard Code 128 spec, values 0..106,
// where 103/104/105 are start codes (A/B/C), 106 is stop.
const CODE128_PATTERNS: readonly string[] = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100',
  '10001001100', '10011001000', '10011000100', '10001100100', '11001001000',
  '11001000100', '11000100100', '10110011100', '10011011100', '10011001110',
  '10111001100', '10011101100', '10011100110', '11001110010', '11001011100',
  '11001001110', '11011100100', '11001110100', '11101101110', '11101001100',
  '11100101100', '11100100110', '11101100100', '11100110100', '11100110010',
  '11011011000', '11011000110', '11000110110', '10100011000', '10001011000',
  '10001000110', '10110001000', '10001101000', '10001100010', '11010001000',
  '11000101000', '11000100010', '10110111000', '10110001110', '10001101110',
  '10111011000', '10111000110', '10001110110', '11101110110', '11010001110',
  '11000101110', '11011101000', '11011100010', '11011101110', '11101011000',
  '11101000110', '11100010110', '11101101000', '11101100010', '11100011010',
  '11101111010', '11001000010', '11110001010', '10100110000', '10100001100',
  '10010110000', '10010000110', '10000101100', '10000100110', '10110010000',
  '10110000100', '10011010000', '10011000010', '10000110100', '10000110010',
  '11000010010', '11001010000', '11110111010', '11000010100', '10001111010',
  '10100111100', '10010111100', '10010011110', '10111100100', '10011110100',
  '10011110010', '11110100100', '11110010100', '11110010010', '11011011110',
  '11011110110', '11110110110', '10101111000', '10100011110', '10001011110',
  '10111101000', '10111100010', '11110101000', '11110100010', '10111011110',
  '10111101110', '11101011110', '11110101110', '11010000100', '11010010000',
  '11010011100', '11000111010',
];

// CODE128 stop pattern (13 modules).
const CODE128_STOP = '1100011101011';

// Start codes: 103 = A, 104 = B, 105 = C. We always use B (mixed alnum).
const START_B = 104;

/**
 * Encode `text` as a CODE128B module string ('1' = bar, '0' = space).
 * Every character must be in the CODE128B range (ASCII 32-127); the repair
 * barcode format REP-YYYYMMDD-NNNNNN meets this trivially. Returns null if
 * an invalid character slips through — the caller renders text-only in that
 * case rather than shipping a garbage barcode.
 */
export function encodeCode128B(text: string): string | null {
  if (!text.length) return null;
  const values: number[] = [START_B];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 32 || code > 127) return null;
    values.push(code - 32);
  }
  // Checksum: (start + sum(value_i * position_i)) mod 103, where position
  // starts at 1 for the first data character.
  let sum = START_B;
  for (let i = 1; i < values.length; i++) {
    sum += values[i] * i;
  }
  values.push(sum % 103);
  let pattern = '';
  for (const v of values) pattern += CODE128_PATTERNS[v];
  pattern += CODE128_STOP;
  return pattern;
}

/**
 * Render a CODE128 barcode as a self-contained SVG string. The SVG is sized
 * for the Dymo 89×38 mm label used by the web version (see
 * `Aeris2/resources/js/Components/Repairs/RepairBarcodeModal.tsx`), with the
 * text baseline drawn under the bars.
 *
 * Returns null if the text can't be encoded (falls back to text-only label).
 */
export function renderBarcodeSvg(
  text: string,
  opts: {moduleWidth?: number; height?: number; fontSize?: number} = {},
): string | null {
  const moduleWidth = opts.moduleWidth ?? 2;
  const height = opts.height ?? 60;
  const fontSize = opts.fontSize ?? 14;
  const pattern = encodeCode128B(text);
  if (!pattern) return null;
  const width = pattern.length * moduleWidth;
  const textY = height + fontSize + 2;
  const svgHeight = textY + 2;
  const rects: string[] = [];
  let runStart = -1;
  for (let i = 0; i <= pattern.length; i++) {
    const bit = i < pattern.length ? pattern[i] : '0';
    if (bit === '1' && runStart === -1) {
      runStart = i;
    } else if (bit !== '1' && runStart !== -1) {
      const w = (i - runStart) * moduleWidth;
      rects.push(
        `<rect x="${runStart * moduleWidth}" y="0" width="${w}" height="${height}" fill="#000"/>`,
      );
      runStart = -1;
    }
  }
  const label = escapeXml(text);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${svgHeight}" viewBox="0 0 ${width} ${svgHeight}">` +
    rects.join('') +
    `<text x="${width / 2}" y="${textY}" text-anchor="middle" font-family="monospace" font-size="${fontSize}" fill="#000">${label}</text>` +
    `</svg>`
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export interface RepairLabelOpts {
  repairNumber: string;
  customerName: string;
  device: string;
  /** ISO date. Displayed as locale date if provided. */
  receivedAt?: string | null;
  checkedInBy?: string | null;
  /** 1..20 — one label per piece, each stamped "Piece N of M". */
  pieces: number;
}

/**
 * Build the printable HTML document for a repair label job. Matches the
 * web RepairBarcodeModal's Dymo 89×38 mm layout byte-for-byte so the same
 * printer / stock works from either surface. Every piece gets its own
 * `<div class="label">` with a `page-break-after: always` rule so the
 * printer feeds each label onto a fresh sheet.
 */
export function buildRepairLabelHtml(opts: RepairLabelOpts): string {
  const {repairNumber, customerName, device, receivedAt, checkedInBy} = opts;
  const pieces = Math.max(1, Math.min(20, Math.floor(opts.pieces)));
  const svg = renderBarcodeSvg(repairNumber);
  const svgMarkup =
    svg ??
    `<p class="fallback">${escapeXml(repairNumber)}</p>`;
  const receivedLabel = receivedAt
    ? new Date(receivedAt).toLocaleDateString()
    : '';
  const labelsHtml = Array.from({length: pieces})
    .map((_, i) => {
      const pieceTag =
        pieces > 1
          ? `<p class="piece">Piece ${i + 1} of ${pieces}</p>`
          : '';
      const checkedIn = checkedInBy
        ? `<p class="meta">Checked in by: ${escapeXml(checkedInBy)}</p>`
        : '';
      const received = receivedLabel
        ? `<p class="meta">Received ${escapeXml(receivedLabel)}</p>`
        : '';
      return `
        <div class="label">
          <p class="title">REPAIR</p>
          ${svgMarkup}
          <p class="customer">${escapeXml(customerName)}</p>
          <p class="device">${escapeXml(device)}</p>
          ${pieceTag}
          ${checkedIn}
          ${received}
        </div>`;
    })
    .join('');
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Repair Label - ${escapeXml(repairNumber)}</title>
<style>
  @page { size: 89mm 38mm; margin: 0; }
  body { margin: 0; padding: 0; font-family: sans-serif; }
  .label {
    width: 89mm;
    height: 38mm;
    padding: 2mm;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    page-break-after: always;
  }
  .label:last-child { page-break-after: auto; }
  .title {
    font-size: 7pt;
    font-weight: bold;
    letter-spacing: 2px;
    color: #444;
    margin: 0 0 1mm 0;
  }
  .customer { font-size: 10pt; font-weight: bold; margin: 1mm 0 0 0; }
  .device {
    font-size: 8pt;
    margin: 0;
    max-width: 85mm;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .piece { font-size: 9pt; font-weight: bold; margin: 0.5mm 0 0 0; }
  .meta { font-size: 7pt; color: #555; margin: 0.5mm 0 0 0; }
  .fallback { font-size: 12pt; font-family: monospace; margin: 2mm 0; }
  svg { max-width: 85mm; flex-shrink: 0; }
</style>
</head>
<body>${labelsHtml}</body>
</html>`;
}
