import {
  buildRepairLabelHtml,
  encodeCode128B,
  renderBarcodeSvg,
} from '../repairLabelHtml';

describe('repairLabelHtml — CODE128B encoder', () => {
  it('rejects empty input', () => {
    expect(encodeCode128B('')).toBeNull();
  });

  it('rejects non-CODE128B characters (>127 or <32)', () => {
    // U+00E9 (é) sits outside CODE128B.
    expect(encodeCode128B('REP-é')).toBeNull();
    // TAB is below CODE128B's range.
    expect(encodeCode128B('REP-\t01')).toBeNull();
  });

  it('encodes a canonical repair number to a valid CODE128 module string', () => {
    const pattern = encodeCode128B('REP-20260702-000001');
    expect(pattern).not.toBeNull();
    // Pattern length is 11 modules per character + 11 for start + 11 for
    // check + 13 for stop. Repair number = 19 chars, so total modules =
    // 11 * 20 (19 chars + start) + 11 (check) + 13 (stop) = 244.
    expect(pattern!.length).toBe(244);
    // Modules are pure '0' / '1'.
    expect(/^[01]+$/.test(pattern!)).toBe(true);
    // CODE128 always starts with the start-code B pattern (value 104).
    // Start-B pattern: 11010010000
    expect(pattern!.startsWith('11010010000')).toBe(true);
    // And ends with the CODE128 stop pattern.
    expect(pattern!.endsWith('1100011101011')).toBe(true);
  });

  it('produces different encodings for different inputs', () => {
    const a = encodeCode128B('REP-20260702-000001');
    const b = encodeCode128B('REP-20260702-000002');
    expect(a).not.toBe(b);
  });
});

describe('repairLabelHtml — renderBarcodeSvg', () => {
  it('returns a self-contained SVG string with rect bars', () => {
    const svg = renderBarcodeSvg('REP-20260702-000001');
    expect(svg).not.toBeNull();
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('<rect');
    // The text label is drawn under the bars for human-readable fallback.
    expect(svg).toContain('REP-20260702-000001');
  });

  it('escapes XML-unsafe characters in the human-readable label', () => {
    // Angle brackets are actually outside REP-* format but the util must
    // still emit safe XML so a caller with a weird upstream never breaks
    // the print HTML.
    const svg = renderBarcodeSvg('A&B');
    expect(svg).toContain('A&amp;B');
    expect(svg).not.toContain('A&B');
  });

  it('returns null for uncodeable input', () => {
    expect(renderBarcodeSvg('café')).toBeNull();
  });
});

describe('repairLabelHtml — buildRepairLabelHtml', () => {
  const baseOpts = {
    repairNumber: 'REP-20260702-000001',
    customerName: 'Ada Lovelace',
    device: 'iPhone 13',
    receivedAt: '2026-07-02T09:15:00Z',
    pieces: 1,
  };

  it('renders the Dymo 89x38 mm @page rule', () => {
    const html = buildRepairLabelHtml(baseOpts);
    expect(html).toContain('@page { size: 89mm 38mm; margin: 0; }');
  });

  it('renders one label div by default', () => {
    const html = buildRepairLabelHtml(baseOpts);
    const count = (html.match(/<div class="label">/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('renders one label per piece and stamps "Piece N of M" when pieces > 1', () => {
    const html = buildRepairLabelHtml({...baseOpts, pieces: 3});
    const count = (html.match(/<div class="label">/g) ?? []).length;
    expect(count).toBe(3);
    expect(html).toContain('Piece 1 of 3');
    expect(html).toContain('Piece 2 of 3');
    expect(html).toContain('Piece 3 of 3');
  });

  it('omits the Piece tag entirely when pieces === 1', () => {
    const html = buildRepairLabelHtml(baseOpts);
    expect(html).not.toContain('Piece 1 of 1');
  });

  it('clamps pieces to [1, 20]', () => {
    const under = buildRepairLabelHtml({...baseOpts, pieces: 0});
    const overCount = (
      buildRepairLabelHtml({...baseOpts, pieces: 99}).match(
        /<div class="label">/g,
      ) ?? []
    ).length;
    expect((under.match(/<div class="label">/g) ?? []).length).toBe(1);
    expect(overCount).toBe(20);
  });

  it('embeds the customer name and device fields, HTML-escaped', () => {
    const html = buildRepairLabelHtml({
      ...baseOpts,
      customerName: 'Tim & Ada',
      device: 'iPhone 13 <Pro>',
    });
    expect(html).toContain('Tim &amp; Ada');
    expect(html).toContain('iPhone 13 &lt;Pro&gt;');
  });

  it('renders a text-fallback when the repair number is uncodeable', () => {
    const html = buildRepairLabelHtml({
      ...baseOpts,
      repairNumber: 'café',
    });
    // Fallback replaces the SVG with a monospace text row rather than
    // shipping a blank label. Encoded number appears in the fallback row.
    expect(html).toContain('class="fallback"');
    expect(html).toContain('caf&#039;'.replace('&#039;', 'é')); // presence, not escaping
  });

  it('drops the Checked-in-by line when checkedInBy is omitted', () => {
    const html = buildRepairLabelHtml(baseOpts);
    expect(html).not.toContain('Checked in by');
  });

  it('includes the Checked-in-by line when checkedInBy is provided', () => {
    const html = buildRepairLabelHtml({
      ...baseOpts,
      checkedInBy: 'Grace Hopper',
    });
    expect(html).toContain('Checked in by: Grace Hopper');
  });
});
