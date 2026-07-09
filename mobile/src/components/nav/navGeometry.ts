// Shared geometry for the Aeris bottom-nav chrome. The bottom chrome is split:
//   - AerisNotchBar: a plain full-width OPAQUE navy bar (height = barTotalHeight)
//     that reserves the tab-bar layout height. Scrollable screen content insets
//     by exactly this, so lists scroll UP to the flat-bar top and slide behind
//     the dome + A (no cream wedges beside the dome any more).
//   - AerisNavButton: a full-screen sibling overlay (never touch/paint-clipped)
//     that draws the navy dome CAP + the A + the fan. The cap rises PROTRUSION
//     above the flat-bar top and blends into the bar (same navy).
// The dome lives in the overlay (not the bar) so it can protrude over scrolling
// content without relying on overflow-visible (which Android clips) and without
// forcing content to inset above it.

export const BTN = 64; // A button diameter
export const BAR_H = 58; // flat navy bar height ABOVE the safe-area inset
export const PROTRUSION = 44; // how far the dome rises above the flat bar top
export const DOME_HALF = BTN / 2 + 28; // half-width of the navy cradle
export const PEAK_Y = 4; // dome peak, in the cap's SVG coordinate space
export const DOME_OVERLAP = 8; // cap extends this far BELOW the flat-bar top to blend
export const ARC = (172 * Math.PI) / 180; // total fan sweep, centred straight up
export const BUBBLE = 78; // fan option column width
export const CIRCLE = 50; // fan option icon-circle diameter

// Height the notch bar reserves as tab-bar layout height (flat bar + safe-area
// inset). The dome protrusion is deliberately NOT reserved — the A floats over
// content so lists scroll behind it edge-to-edge. Fixed bottom CTAs pad
// themselves by A_CLEARANCE instead (see useNavAClearance).
export function barTotalHeight(insetBottom: number): number {
  return BAR_H + insetBottom;
}

// Extra bottom padding a screen with a fixed/bottom-flush CTA should add on top
// of the tab-bar inset so its button clears the floating A rather than being
// overlapped (and tap-stolen) by it.
export const A_CLEARANCE = PROTRUSION + 8;

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

// SVG path for the navy dome CAP drawn in the overlay: just the centre bump
// (flanks transparent so scrolling content shows beside it), with a short
// `DOME_OVERLAP` skirt below the flat-bar top so it merges seamlessly into the
// opaque navy bar. Canvas height = PROTRUSION + DOME_OVERLAP; the flat-bar-top
// line sits at y = PROTRUSION.
export function domeCapPath(width: number): {d: string; svgH: number} {
  const svgH = PROTRUSION + DOME_OVERLAP;
  const cx = width / 2;
  const top = PROTRUSION;
  const sx = cx - DOME_HALF;
  const ex = cx + DOME_HALF;
  const d =
    `M${sx},${svgH} L${sx},${top} ` +
    `C${sx + 20},${top} ${cx - DOME_HALF * 0.5},${PEAK_Y} ${cx},${PEAK_Y} ` +
    `C${cx + DOME_HALF * 0.5},${PEAK_Y} ${ex - 20},${top} ${ex},${top} ` +
    `L${ex},${svgH} Z`;
  return {d, svgH};
}
