import {productAllowsDecimalQuantity} from '../types/api.types';

describe('productAllowsDecimalQuantity', () => {
  it('returns false for null/undefined', () => {
    expect(productAllowsDecimalQuantity(null)).toBe(false);
    expect(productAllowsDecimalQuantity(undefined)).toBe(false);
  });

  it('prefers the server allows_decimal_quantity flag when present', () => {
    // Flag wins even if unit_type would disagree.
    expect(
      productAllowsDecimalQuantity({
        allows_decimal_quantity: true,
        unit_type: 'each',
      }),
    ).toBe(true);
    expect(
      productAllowsDecimalQuantity({
        allows_decimal_quantity: false,
        unit_type: 'm',
      }),
    ).toBe(false);
  });

  it('falls back to unit_type when the flag is absent', () => {
    expect(productAllowsDecimalQuantity({unit_type: 'm'})).toBe(true);
    expect(productAllowsDecimalQuantity({unit_type: 'kg'})).toBe(true);
    expect(productAllowsDecimalQuantity({unit_type: 'each'})).toBe(false);
  });

  it('treats a missing/empty unit_type as whole-number (each)', () => {
    expect(productAllowsDecimalQuantity({})).toBe(false);
    expect(productAllowsDecimalQuantity({unit_type: null})).toBe(false);
    expect(productAllowsDecimalQuantity({unit_type: ''})).toBe(false);
  });
});
