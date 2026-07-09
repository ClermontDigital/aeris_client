// Shared geometry for the Aeris bottom-nav chrome — the notch bar (which
// paints the navy cradle + reserves layout height) and the overlay button +
// fan (which floats above, unclipped, so the protruding A stays tappable).
// Both must agree on where the button centre sits, so the button visually
// nests into the dome the notch bar draws.

export const BTN = 64; // A button diameter
export const BAR_H = 58; // flat navy bar height ABOVE the safe-area inset
export const PROTRUSION = 44; // how far the dome rises above the flat bar top
export const DOME_HALF = BTN / 2 + 28; // half-width of the navy cradle
export const PEAK_Y = 4; // dome peak, in the bar's SVG coordinate space
export const ARC = (172 * Math.PI) / 180; // total fan sweep, centred straight up
export const BUBBLE = 78; // fan option column width
export const CIRCLE = 50; // fan option icon-circle diameter

// The button centre sits on the flat-bar-top line (== `height - barH`), so its
// lower half overlaps the bar and its upper half nests into the dome.
export function barTotalHeight(insetBottom: number): number {
  return BAR_H + insetBottom;
}

// Offset (radians) from straight-up for option i of n across the arc.
export function angleFor(i: number, n: number): number {
  if (n <= 1) return 0;
  return -ARC / 2 + i * (ARC / (n - 1));
}

// Fan radius scales with item count so the bubbles stay comfortably spaced.
export function radiusFor(n: number): number {
  const r = ((n - 1) * 74) / ARC;
  return Math.max(132, Math.min(184, r));
}

// SVG path for the navy bar + centre dome, drawn in a canvas of
// height (PROTRUSION + barH). The flat bar top sits at y = PROTRUSION; the
// centre rises smoothly to PEAK_Y to cradle the button.
export function domePath(width: number, barH: number): {d: string; svgH: number} {
  const svgH = PROTRUSION + barH;
  const cx = width / 2;
  const top = PROTRUSION;
  const sx = cx - DOME_HALF;
  const ex = cx + DOME_HALF;
  const d =
    `M0,${top} L${sx},${top} ` +
    `C${sx + 20},${top} ${cx - DOME_HALF * 0.5},${PEAK_Y} ${cx},${PEAK_Y} ` +
    `C${cx + DOME_HALF * 0.5},${PEAK_Y} ${ex - 20},${top} ${ex},${top} ` +
    `L${width},${top} L${width},${svgH} L0,${svgH} Z`;
  return {d, svgH};
}
