import {normalizeAddress, normalizeCustomer} from '../services/ApiClient';

describe('normalizeAddress', () => {
  it('flattens common Aeris2 + alternate field shapes', () => {
    const a = normalizeAddress({
      id: 7,
      label: 'Home',
      line_1: '12 King St',
      line_2: 'Suite 4',
      city: 'Sydney',
      state: 'NSW',
      postcode: '2000',
      country: 'AU',
    });
    expect(a).toEqual({
      id: 7,
      label: 'Home',
      line_1: '12 King St',
      line_2: 'Suite 4',
      city: 'Sydney',
      state: 'NSW',
      postcode: '2000',
      country: 'AU',
    });
  });

  it('accepts alternate field aliases (line1, postal_code, country_code, locality, region)', () => {
    const a = normalizeAddress({
      line1: '101 Main',
      locality: 'Melbourne',
      region: 'VIC',
      postal_code: '3000',
      country_code: 'AU',
    });
    expect(a.line_1).toBe('101 Main');
    expect(a.city).toBe('Melbourne');
    expect(a.state).toBe('VIC');
    expect(a.postcode).toBe('3000');
    expect(a.country).toBe('AU');
  });

  it('returns id=null when missing and string nulls for label/state/country/line_2', () => {
    const a = normalizeAddress({line_1: '1 Park Ave', city: 'Auckland', postcode: '1010'});
    expect(a.id).toBeNull();
    expect(a.label).toBeNull();
    expect(a.line_2).toBeNull();
    expect(a.state).toBeNull();
    expect(a.country).toBeNull();
  });
});

describe('normalizeCustomer', () => {
  it('builds full name from first_name + last_name when `name` is missing', () => {
    const c = normalizeCustomer({first_name: 'Ada', last_name: 'Lovelace'});
    expect(c.name).toBe('Ada Lovelace');
    expect(c.first_name).toBe('Ada');
    expect(c.last_name).toBe('Lovelace');
  });

  it('prefers explicit `name` over first/last when present', () => {
    const c = normalizeCustomer({name: 'Ada L.', first_name: 'Ada', last_name: 'Lovelace'});
    expect(c.name).toBe('Ada L.');
  });

  it('prefers _cents over dollar fields for account_balance / credit_limit / total_spent', () => {
    const c = normalizeCustomer({
      account_balance_cents: 5000,
      account_balance: 999.99,
      credit_limit_cents: 100000,
      credit_limit: 0,
      total_spent_cents: 250000,
      total_spent: 0,
    });
    expect(c.account_balance_cents).toBe(5000);
    expect(c.credit_limit_cents).toBe(100000);
    expect(c.total_spent_cents).toBe(250000);
  });

  it('converts dollar amounts to cents when _cents fields are absent', () => {
    const c = normalizeCustomer({
      account_balance: 12.34,
      credit_limit: 1000,
      total_spent: 4567.89,
    });
    expect(c.account_balance_cents).toBe(1234);
    expect(c.credit_limit_cents).toBe(100000);
    expect(c.total_spent_cents).toBe(456789);
  });

  it('leaves money fields null when neither cents nor dollar variant is present', () => {
    const c = normalizeCustomer({first_name: 'A'});
    expect(c.account_balance_cents).toBeNull();
    expect(c.credit_limit_cents).toBeNull();
    expect(c.total_spent_cents).toBeNull();
    expect(c.loyalty_points).toBeNull();
    expect(c.total_orders).toBeNull();
  });

  it('normalizes recent_sales via the existing normalizeSale (cents derivation)', () => {
    const c = normalizeCustomer({
      recent_sales: [
        {
          id: 1,
          sale_number: 'S-1',
          total_amount: 12.5, // dollars only
          status: 'completed',
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 2,
          sale_number: 'S-2',
          total_cents: 999,
          status: 'refunded',
          created_at: '2026-01-02T00:00:00Z',
        },
      ],
    });
    expect(c.recent_sales).toHaveLength(2);
    expect(c.recent_sales[0].total_cents).toBe(1250);
    expect(c.recent_sales[1].total_cents).toBe(999);
    expect(c.recent_sales[0].status).toBe('completed');
    expect(c.recent_sales[1].status).toBe('refunded');
  });

  it('unwraps {data: [...]} wrapper around recent_sales', () => {
    const c = normalizeCustomer({
      recent_sales: {data: [{id: 1, sale_number: 'S-1', total_cents: 100}]},
    });
    expect(c.recent_sales).toHaveLength(1);
    expect(c.recent_sales[0].sale_number).toBe('S-1');
  });

  it('flattens addresses and uses explicit default_address when present', () => {
    const c = normalizeCustomer({
      default_address: {line_1: 'A St', city: 'A', postcode: '1', label: 'Default'},
      addresses: [
        {line_1: 'A St', city: 'A', postcode: '1', label: 'Default'},
        {line_1: 'B St', city: 'B', postcode: '2', label: 'Office'},
      ],
    });
    expect(c.addresses).toHaveLength(2);
    expect(c.default_address?.line_1).toBe('A St');
    expect(c.default_address?.label).toBe('Default');
  });

  it('falls back to is_default flag when default_address is not provided', () => {
    const c = normalizeCustomer({
      addresses: [
        {line_1: 'A St', city: 'A', postcode: '1'},
        {line_1: 'B St', city: 'B', postcode: '2', is_default: true},
      ],
    });
    expect(c.default_address?.line_1).toBe('B St');
  });

  it('falls back to first address when no default and no is_default flag', () => {
    const c = normalizeCustomer({
      addresses: [
        {line_1: 'A St', city: 'A', postcode: '1'},
        {line_1: 'B St', city: 'B', postcode: '2'},
      ],
    });
    expect(c.default_address?.line_1).toBe('A St');
  });

  it('returns empty arrays when recent_sales / addresses missing', () => {
    const c = normalizeCustomer({});
    expect(c.recent_sales).toEqual([]);
    expect(c.addresses).toEqual([]);
    expect(c.default_address).toBeNull();
  });

  it('passes through new string-shaped fields', () => {
    const c = normalizeCustomer({
      company: 'Acme Co',
      mobile: '+61 400 000 000',
      customer_number: 'CUS-0001',
      payment_terms: 'Net 30',
      last_purchase_date: '2026-04-30T00:00:00Z',
      notes: 'VIP — call before 5pm',
      created_at: '2024-06-12T08:00:00Z',
    });
    expect(c.company).toBe('Acme Co');
    expect(c.mobile).toBe('+61 400 000 000');
    expect(c.customer_number).toBe('CUS-0001');
    expect(c.payment_terms).toBe('Net 30');
    expect(c.last_purchase_date).toBe('2026-04-30T00:00:00Z');
    expect(c.notes).toBe('VIP — call before 5pm');
    expect(c.created_at).toBe('2024-06-12T08:00:00Z');
  });

  it('parses integer-like strings for loyalty_points and total_orders', () => {
    const c = normalizeCustomer({loyalty_points: '420', total_orders: '17'});
    expect(c.loyalty_points).toBe(420);
    expect(c.total_orders).toBe(17);
  });
});
