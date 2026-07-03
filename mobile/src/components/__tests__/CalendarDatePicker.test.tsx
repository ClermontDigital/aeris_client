import {
  formatHuman,
  formatYmd,
  parseYmd,
} from '../CalendarDatePicker';

describe('CalendarDatePicker date helpers', () => {
  describe('parseYmd', () => {
    it('parses a valid YYYY-MM-DD into 0-based month parts', () => {
      expect(parseYmd('2026-08-01')).toEqual({y: 2026, m: 7, d: 1});
    });

    it('returns null for empty / null / undefined', () => {
      expect(parseYmd('')).toBeNull();
      expect(parseYmd(null)).toBeNull();
      expect(parseYmd(undefined)).toBeNull();
    });

    it('returns null for malformed / out-of-range strings', () => {
      expect(parseYmd('2026-8-1')).toBeNull(); // not zero-padded
      expect(parseYmd('2026/08/01')).toBeNull();
      expect(parseYmd('2026-13-01')).toBeNull(); // month out of range
      expect(parseYmd('2026-08-40')).toBeNull(); // day out of range
      expect(parseYmd('not-a-date')).toBeNull();
    });
  });

  describe('formatYmd', () => {
    it('re-pads month + day (input month is 0-based)', () => {
      expect(formatYmd(2026, 7, 1)).toBe('2026-08-01');
      expect(formatYmd(2026, 11, 25)).toBe('2026-12-25');
    });

    it('round-trips with parseYmd', () => {
      const s = '2026-02-09';
      const p = parseYmd(s)!;
      expect(formatYmd(p.y, p.m, p.d)).toBe(s);
    });
  });

  describe('formatHuman', () => {
    it('renders a readable label', () => {
      expect(formatHuman('2026-08-01')).toBe('1 August 2026');
      expect(formatHuman('2026-12-25')).toBe('25 December 2026');
    });

    it('returns null for unparseable input', () => {
      expect(formatHuman('')).toBeNull();
      expect(formatHuman(null)).toBeNull();
      expect(formatHuman('garbage')).toBeNull();
    });
  });
});
