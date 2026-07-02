import {
  normalizePendingRepair,
  normalizeRepair,
  normalizeRepairDetail,
  normalizeRepairItem,
  normalizeRepairStatusHistory,
} from '../normalizers';

// Wire shape mirrors Aeris2's RepairResource + RepairItemResource. Money fields
// travel as dollar FLOATS (not cents), status is the enum's `.value` string.

describe('normalizeRepair', () => {
  it('flattens the RepairResource list shape end-to-end', () => {
    const r = normalizeRepair({
      id: 42,
      repair_number: 'REP-20260702-000123',
      customer_id: 7,
      location_id: 3,
      sale_id: null,
      created_by: 11,
      assigned_to: 13,
      device_type: 'Laptop',
      brand: 'Dell',
      model: 'XPS 13',
      serial_number: 'SN123',
      issue_description: 'Screen flickers under load',
      diagnosis: null,
      notes: null,
      estimated_cost: 149.5,
      final_cost: null,
      status: 'pending',
      priority: 'normal',
      received_at: '2026-07-02T08:00:00.000000Z',
      estimated_completion: null,
      completed_at: null,
      picked_up_at: null,
      created_at: '2026-07-02T08:00:00.000000Z',
      updated_at: '2026-07-02T08:00:00.000000Z',
    });
    expect(r.id).toBe(42);
    expect(r.repair_number).toBe('REP-20260702-000123');
    expect(r.customer_id).toBe(7);
    expect(r.sale_id).toBeNull();
    expect(r.assigned_to).toBe(13);
    expect(r.issue_description).toBe('Screen flickers under load');
    expect(r.estimated_cost).toBe(149.5);
    expect(r.final_cost).toBeNull();
    expect(r.status).toBe('pending');
    expect(r.priority).toBe('normal');
  });

  it('flattens nested `customer` (whenLoaded) into customer_id + customer_name', () => {
    const r = normalizeRepair({
      id: 1,
      customer: {id: 9, name: 'Acme Corp', email: 'a@b.c', phone: '0400'},
      status: 'ready',
    });
    expect(r.customer_id).toBe(9);
    expect(r.customer_name).toBe('Acme Corp');
  });

  it('prefers top-level customer_id + customer_name over nested customer', () => {
    const r = normalizeRepair({
      id: 1,
      customer_id: 99,
      customer_name: 'Flat Wins',
      customer: {id: 9, name: 'Nested Loses'},
      status: 'pending',
    });
    expect(r.customer_id).toBe(99);
    expect(r.customer_name).toBe('Flat Wins');
  });

  it('lifts assignedTo.name into assigned_to_name (whenLoaded shape)', () => {
    const r = normalizeRepair({
      id: 1,
      assigned_to: 5,
      assignedTo: {id: 5, name: 'Alex T.'},
      status: 'in_progress',
    });
    expect(r.assigned_to).toBe(5);
    expect(r.assigned_to_name).toBe('Alex T.');
  });

  it('coerces unknown status values to `pending` (forward-compat)', () => {
    const r = normalizeRepair({id: 1, status: 'quantum_flux'});
    expect(r.status).toBe('pending');
  });

  it('coerces missing priority to `normal`', () => {
    const r = normalizeRepair({id: 1, status: 'pending'});
    expect(r.priority).toBe('normal');
  });

  it('coerces a non-string priority (garbage from a broken deployment) to `normal`', () => {
    const r = normalizeRepair({id: 1, status: 'pending', priority: 123});
    expect(r.priority).toBe('normal');
  });

  it('falls back from issue_description to reported_issue on older Aeris2', () => {
    const r = normalizeRepair({
      id: 1,
      reported_issue: 'Cracked screen',
      status: 'pending',
    });
    expect(r.issue_description).toBe('Cracked screen');
  });

  it('prefers issue_description when both are present', () => {
    const r = normalizeRepair({
      id: 1,
      issue_description: 'Fresh field',
      reported_issue: 'Stale field',
      status: 'pending',
    });
    expect(r.issue_description).toBe('Fresh field');
  });

  it('distinguishes null cost (not yet quoted) from 0 (explicitly free)', () => {
    const r1 = normalizeRepair({id: 1, estimated_cost: null, status: 'pending'});
    expect(r1.estimated_cost).toBeNull();
    const r2 = normalizeRepair({id: 1, estimated_cost: 0, status: 'pending'});
    expect(r2.estimated_cost).toBe(0);
  });

  it('accepts a stringly-typed dollar cost (some Aeris2 endpoints stringify)', () => {
    const r = normalizeRepair({id: 1, estimated_cost: '89.95', status: 'pending'});
    expect(r.estimated_cost).toBe(89.95);
  });

  it('nulls foreign keys that are absent OR explicit null', () => {
    const r = normalizeRepair({id: 1, status: 'pending'});
    expect(r.customer_id).toBeNull();
    expect(r.location_id).toBeNull();
    expect(r.sale_id).toBeNull();
    expect(r.created_by).toBeNull();
    expect(r.assigned_to).toBeNull();
  });
});

describe('normalizeRepairItem', () => {
  it('carries snapshot + product fields', () => {
    const item = normalizeRepairItem({
      id: 501,
      repair_id: 42,
      product_id: 900,
      item_name: 'Screen Assembly',
      item_sku: 'SCR-XPS13',
      item_type: 'part',
      quantity: 1,
      unit_price: 249.0,
      line_total: 249.0,
      notes: null,
      status: 'reserved',
      created_at: '2026-07-02T08:00:00.000000Z',
      updated_at: '2026-07-02T08:00:00.000000Z',
    });
    expect(item.id).toBe(501);
    expect(item.item_name).toBe('Screen Assembly');
    expect(item.item_type).toBe('part');
    expect(item.unit_price).toBe(249);
    expect(item.line_total).toBe(249);
    expect(item.status).toBe('reserved');
  });

  it('accepts labor lines with no product_id', () => {
    const item = normalizeRepairItem({
      id: 502,
      repair_id: 42,
      product_id: null,
      item_name: 'Diagnosis (30m)',
      item_sku: null,
      item_type: 'labor',
      quantity: 1,
      unit_price: 45,
      line_total: 45,
      status: 'reserved',
    });
    expect(item.product_id).toBeNull();
    expect(item.item_type).toBe('labor');
    expect(item.item_sku).toBeNull();
  });

  it('coerces unknown item_type to `part` and unknown status to `reserved`', () => {
    const item = normalizeRepairItem({
      id: 1,
      repair_id: 1,
      item_name: 'Thing',
      item_type: 'gizmo',
      status: 'quantum',
      quantity: 2,
    });
    expect(item.item_type).toBe('part');
    expect(item.status).toBe('reserved');
    expect(item.quantity).toBe(2);
  });

  it('defaults quantity to 1 and unit_price/line_total to 0 on absent', () => {
    const item = normalizeRepairItem({id: 1, repair_id: 1, item_name: 'X'});
    expect(item.quantity).toBe(1);
    expect(item.unit_price).toBe(0);
    expect(item.line_total).toBe(0);
  });
});

describe('normalizeRepairStatusHistory', () => {
  it('carries user id + name when both present', () => {
    const h = normalizeRepairStatusHistory({
      id: 1,
      from_status: 'pending',
      to_status: 'diagnosed',
      notes: 'Loose ribbon cable',
      changed_at: '2026-07-02T09:00:00.000000Z',
      user: {id: 3, name: 'Sam K.'},
    });
    expect(h.id).toBe(1);
    expect(h.from_status).toBe('pending');
    expect(h.to_status).toBe('diagnosed');
    expect(h.user).toEqual({id: 3, name: 'Sam K.'});
  });

  it('null-safes a missing user embed (deployment-team-flagged edge case)', () => {
    const h = normalizeRepairStatusHistory({
      id: 2,
      to_status: 'pending',
      user: null,
    });
    expect(h.user).toEqual({id: 0, name: 'Unknown user'});
  });

  it('null-safes a user object with missing name', () => {
    const h = normalizeRepairStatusHistory({
      id: 3,
      to_status: 'pending',
      user: {id: 7},
    });
    expect(h.user).toEqual({id: 7, name: 'Unknown user'});
  });

  it('accepts a null from_status (first history row)', () => {
    const h = normalizeRepairStatusHistory({
      id: 4,
      from_status: null,
      to_status: 'pending',
      user: {id: 1, name: 'x'},
    });
    expect(h.from_status).toBeNull();
    expect(h.to_status).toBe('pending');
  });

  it('coerces an unknown to_status to `pending` fail-safe', () => {
    const h = normalizeRepairStatusHistory({
      id: 5,
      to_status: 'quantum',
      user: {id: 1, name: 'x'},
    });
    expect(h.to_status).toBe('pending');
  });
});

describe('normalizeRepairDetail', () => {
  it('nests items[] + status_history[] + customer subset', () => {
    const d = normalizeRepairDetail({
      id: 42,
      repair_number: 'REP-000042',
      status: 'ready',
      customer: {id: 9, name: 'Nested', email: 'n@a.com', phone: '0400'},
      items: [
        {id: 1, repair_id: 42, item_name: 'Battery', item_type: 'part', quantity: 1, unit_price: 129, line_total: 129, status: 'installed'},
      ],
      statusHistory: [
        {id: 1, from_status: null, to_status: 'pending', user: {id: 1, name: 'Sam'}},
        {id: 2, from_status: 'pending', to_status: 'ready', user: null},
      ],
    });
    expect(d.items).toHaveLength(1);
    expect(d.items[0].item_name).toBe('Battery');
    expect(d.status_history).toHaveLength(2);
    expect(d.status_history[1].user).toEqual({id: 0, name: 'Unknown user'});
    expect(d.customer).toEqual({id: 9, name: 'Nested', email: 'n@a.com', phone: '0400'});
  });

  it('accepts snake_case `status_history` as a fallback for the wire key', () => {
    const d = normalizeRepairDetail({
      id: 1,
      status: 'pending',
      status_history: [
        {id: 1, from_status: null, to_status: 'pending', user: {id: 1, name: 'x'}},
      ],
    });
    expect(d.status_history).toHaveLength(1);
  });

  it('renders empty items[] + status_history[] when relations not loaded', () => {
    const d = normalizeRepairDetail({id: 1, status: 'pending'});
    expect(d.items).toEqual([]);
    expect(d.status_history).toEqual([]);
    expect(d.customer).toBeNull();
  });
});

describe('normalizePendingRepair', () => {
  it('handles the POS-scoped pending-repairs response shape', () => {
    const p = normalizePendingRepair({
      id: 42,
      repair_number: 'REP-000042',
      issue_description: 'Battery swap',
      device_type: 'Laptop',
      brand: 'Dell',
      model: 'XPS 13',
      estimated_cost: 129,
      final_cost: 129,
      received_at: '2026-07-02T08:00:00.000000Z',
    });
    expect(p.id).toBe(42);
    expect(p.issue_description).toBe('Battery swap');
    expect(p.estimated_cost).toBe(129);
  });

  it('falls back to reported_issue on older wire', () => {
    const p = normalizePendingRepair({
      id: 1,
      repair_number: 'REP-01',
      reported_issue: 'Cracked screen',
    });
    expect(p.issue_description).toBe('Cracked screen');
  });
});
