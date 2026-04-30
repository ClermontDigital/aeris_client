import {
  normalizeProduct,
  normalizeProductDetail,
  normalizeProductVariant,
} from '../services/ApiClient';

describe('normalizeProduct', () => {
  it('prefers price_cents when present', () => {
    const p = normalizeProduct({
      id: 1,
      name: 'Widget',
      sku: 'WID-1',
      barcode: '123',
      price_cents: 1234,
      tax_rate: 10,
      stock_on_hand: 5,
      category_id: 7,
      category_name: 'Tools',
      image_url: 'https://example.com/x.png',
      is_active: true,
    });
    expect(p.price_cents).toBe(1234);
    expect(p.stock_on_hand).toBe(5);
    expect(p.category_id).toBe(7);
    expect(p.category_name).toBe('Tools');
    expect(p.is_active).toBe(true);
  });

  it('derives price_cents from dollar price when cents missing', () => {
    const p = normalizeProduct({
      id: 2,
      name: 'Gadget',
      sku: 'GAD-1',
      price: 12.34,
    });
    expect(p.price_cents).toBe(1234);
  });

  it('parses price encoded as a numeric string', () => {
    const p = normalizeProduct({
      id: 3,
      name: 'Thing',
      sku: 'THG-1',
      price: '99.95',
    });
    expect(p.price_cents).toBe(9995);
  });

  it('falls back from stock_on_hand to stock_quantity', () => {
    const p = normalizeProduct({
      id: 4,
      name: 'X',
      sku: 'X-1',
      price: 1,
      stock_quantity: 12,
    });
    expect(p.stock_on_hand).toBe(12);
  });

  it('flattens category_id and category_name from nested category object', () => {
    const p = normalizeProduct({
      id: 5,
      name: 'Y',
      sku: 'Y-1',
      price: 1,
      category: {id: 42, name: 'Hardware', description: 'stuff'},
    });
    expect(p.category_id).toBe(42);
    expect(p.category_name).toBe('Hardware');
  });

  it('prefers top-level category_id / category_name over nested category', () => {
    const p = normalizeProduct({
      id: 6,
      name: 'Z',
      sku: 'Z-1',
      price: 1,
      category_id: 99,
      category_name: 'Flat',
      category: {id: 42, name: 'Nested', description: ''},
    });
    expect(p.category_id).toBe(99);
    expect(p.category_name).toBe('Flat');
  });

  it('returns null category fields when absent', () => {
    const p = normalizeProduct({id: 7, name: 'A', sku: 'A-1', price: 1});
    expect(p.category_id).toBeNull();
    expect(p.category_name).toBeNull();
  });

  it('defaults is_active to true when missing so items remain sellable', () => {
    const p = normalizeProduct({id: 8, name: 'B', sku: 'B-1', price: 1});
    expect(p.is_active).toBe(true);
  });

  it('respects explicit is_active=false', () => {
    const p = normalizeProduct({
      id: 9,
      name: 'C',
      sku: 'C-1',
      price: 1,
      is_active: false,
    });
    expect(p.is_active).toBe(false);
  });

  it('handles undefined input defensively', () => {
    const p = normalizeProduct(undefined);
    expect(p.id).toBe(0);
    expect(p.price_cents).toBe(0);
    expect(p.stock_on_hand).toBe(0);
    expect(p.category_id).toBeNull();
    expect(p.is_active).toBe(true);
  });

  it('passes tax_rate through as-is', () => {
    const p = normalizeProduct({
      id: 10,
      name: 'D',
      sku: 'D-1',
      price: 1,
      tax_rate: 10.0,
    });
    expect(p.tax_rate).toBe(10);
  });

  it('barcode is null when not a string', () => {
    const p = normalizeProduct({id: 11, name: 'E', sku: 'E-1', price: 1});
    expect(p.barcode).toBeNull();
  });
});

describe('normalizeProductDetail', () => {
  it('inherits Product fields plus description and variants', () => {
    const d = normalizeProductDetail({
      id: 1,
      name: 'Widget',
      sku: 'WID-1',
      price_cents: 500,
      description: 'A widget',
      cost_cents: 250,
      variants: [
        {id: 11, name: 'Red', sku: 'WID-1-R', price_cents: 600, stock_on_hand: 3},
      ],
    });
    expect(d.price_cents).toBe(500);
    expect(d.description).toBe('A widget');
    expect(d.cost_cents).toBe(250);
    expect(d.variants).toHaveLength(1);
    expect(d.variants[0].price_cents).toBe(600);
    expect(d.stock_levels).toEqual([]);
  });

  it('derives cost_cents from cost_price dollars when cost_cents missing', () => {
    const d = normalizeProductDetail({
      id: 2,
      name: 'X',
      sku: 'X-1',
      price: 12.34,
      cost_price: 5.5,
    });
    expect(d.cost_cents).toBe(550);
  });

  it('returns null cost_cents when neither field is present (permission-gated)', () => {
    const d = normalizeProductDetail({
      id: 3,
      name: 'Y',
      sku: 'Y-1',
      price: 1,
    });
    expect(d.cost_cents).toBeNull();
  });

  it('description is null when not a string', () => {
    const d = normalizeProductDetail({id: 4, name: 'Z', sku: 'Z-1', price: 1});
    expect(d.description).toBeNull();
  });

  it('variants default to empty array when missing', () => {
    const d = normalizeProductDetail({id: 5, name: 'A', sku: 'A-1', price: 1});
    expect(d.variants).toEqual([]);
  });

  it('flattens nested category in detail too', () => {
    const d = normalizeProductDetail({
      id: 6,
      name: 'B',
      sku: 'B-1',
      price: 1,
      category: {id: 33, name: 'Cat', description: ''},
    });
    expect(d.category_id).toBe(33);
    expect(d.category_name).toBe('Cat');
  });

  it('handles undefined input defensively', () => {
    const d = normalizeProductDetail(undefined);
    expect(d.id).toBe(0);
    expect(d.cost_cents).toBeNull();
    expect(d.variants).toEqual([]);
    expect(d.stock_levels).toEqual([]);
  });
});

describe('normalizeProductVariant', () => {
  it('normalizes price_cents-shaped variant', () => {
    const v = normalizeProductVariant({
      id: 1,
      name: 'Small',
      sku: 'X-S',
      price_cents: 500,
      stock_on_hand: 3,
    });
    expect(v.price_cents).toBe(500);
    expect(v.stock_on_hand).toBe(3);
  });

  it('normalizes Aeris2-shaped variant (price dollars + stock_quantity)', () => {
    const v = normalizeProductVariant({
      id: 2,
      name: 'Large',
      sku: 'X-L',
      price: 7.5,
      stock_quantity: 10,
    });
    expect(v.price_cents).toBe(750);
    expect(v.stock_on_hand).toBe(10);
  });
});
