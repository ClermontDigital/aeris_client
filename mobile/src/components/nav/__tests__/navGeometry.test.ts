import {
  A_CLEARANCE,
  angleFor,
  ARC,
  barTotalHeight,
  BAR_H,
  BTN,
  buttonCenterFromBottom,
  domeCapPath,
  DOME_OVERLAP,
  PROTRUSION,
  radiusFor,
} from '../navGeometry';

describe('navGeometry', () => {
  describe('angleFor', () => {
    it('spans the full arc, centred on straight-up (0)', () => {
      const n = 7;
      expect(angleFor(0, n)).toBeCloseTo(-ARC / 2, 6);
      expect(angleFor(n - 1, n)).toBeCloseTo(ARC / 2, 6);
      // Middle item points straight up.
      expect(angleFor((n - 1) / 2, n)).toBeCloseTo(0, 6);
    });

    it('is symmetric about the centre', () => {
      const n = 6;
      for (let i = 0; i < n; i++) {
        expect(angleFor(i, n)).toBeCloseTo(-angleFor(n - 1 - i, n), 6);
      }
    });

    it('returns 0 for a single item', () => {
      expect(angleFor(0, 1)).toBe(0);
    });
  });

  describe('radiusFor', () => {
    it('clamps to the [132, 184] band', () => {
      expect(radiusFor(1)).toBe(132); // tiny count → floor
      expect(radiusFor(50)).toBe(184); // huge count → ceiling
    });

    it('grows with the item count inside the band', () => {
      expect(radiusFor(7)).toBeGreaterThan(radiusFor(6));
    });
  });

  describe('barTotalHeight', () => {
    it('is the thin bar height plus the safe-area inset', () => {
      expect(barTotalHeight(0)).toBe(BAR_H);
      expect(barTotalHeight(34)).toBe(BAR_H + 34);
    });
  });

  describe('buttonCenterFromBottom', () => {
    it('follows the bar top when the inset is generous', () => {
      // 10 + 34 = 44, above the floor.
      expect(buttonCenterFromBottom(34)).toBe(BAR_H + 34);
    });

    it('is floored so the A is never clipped on a thin bar with no inset', () => {
      // 10 + 0 = 10 would clip the A; floor to BTN/2 + 8.
      expect(buttonCenterFromBottom(0)).toBe(BTN / 2 + 8);
      expect(buttonCenterFromBottom(0)).toBeGreaterThan(barTotalHeight(0));
    });
  });

  describe('A_CLEARANCE', () => {
    it('exceeds the dome protrusion so a bottom CTA fully clears the A', () => {
      expect(A_CLEARANCE).toBeGreaterThan(PROTRUSION);
    });
  });

  describe('domeCapPath', () => {
    it('canvas = protrusion + overlap, and is a closed centre bump', () => {
      const {d, svgH} = domeCapPath(390);
      expect(svgH).toBe(PROTRUSION + DOME_OVERLAP);
      // Closed polygon.
      expect(d.trim().endsWith('Z')).toBe(true);
      // Bump is centred and narrower than full width (flanks transparent) —
      // it starts at the left dome edge (sx > 0), not at x = 0.
      const startX = Number(d.slice(1, d.indexOf(',')));
      expect(startX).toBeGreaterThan(0);
      expect(startX).toBeLessThan(390 / 2);
    });
  });
});
