import {
  angleFor,
  ARC,
  barTotalHeight,
  BAR_H,
  chromeHeight,
  domePath,
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
    it('is the flat bar height plus the safe-area inset', () => {
      expect(barTotalHeight(0)).toBe(BAR_H);
      expect(barTotalHeight(34)).toBe(BAR_H + 34);
    });
  });

  describe('chromeHeight', () => {
    it('reserves the flat bar + the dome protrusion (so CTAs inset above it)', () => {
      expect(chromeHeight(0)).toBe(BAR_H + PROTRUSION);
      expect(chromeHeight(34)).toBe(BAR_H + 34 + PROTRUSION);
    });

    it('equals the domePath SVG canvas height', () => {
      const barH = barTotalHeight(34);
      const {svgH} = domePath(390, barH);
      expect(chromeHeight(34)).toBe(svgH);
    });
  });

  describe('domePath', () => {
    it('opens a canvas PROTRUSION taller than the bar and closes the shape', () => {
      const {d, svgH} = domePath(390, 92);
      expect(svgH).toBe(PROTRUSION + 92);
      // Flat bar top sits at y = PROTRUSION; the path starts there on the left.
      expect(d.startsWith(`M0,${PROTRUSION} `)).toBe(true);
      // Closed polygon.
      expect(d.trim().endsWith('Z')).toBe(true);
      // Spans the full width.
      expect(d).toContain('L390,');
    });
  });
});
