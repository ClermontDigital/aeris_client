import {RelayClient, RelayError} from '../relay';

type FetchMock = jest.Mock<Promise<Response>, [RequestInfo, RequestInit?]>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

// Polyfill for older Node runners so createRepair / addRepairItem can generate
// their idempotency keys — mirrors RelayClient.test.ts.
if (!(globalThis as {crypto?: {randomUUID?: () => string}}).crypto?.randomUUID) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require('crypto');
  (globalThis as {crypto: {randomUUID: () => string}}).crypto = {
    randomUUID: () => nodeCrypto.randomUUID(),
  };
}

function envelope(
  action: string,
  data: unknown,
  status: 'ok' | 'error' | 'timeout' = 'ok',
  error?: {code: string; message: string},
) {
  return {
    correlation_id: `cid-${action}`,
    action,
    status,
    ...(data !== undefined ? {data} : {}),
    ...(error ? {error} : {}),
  };
}

// Bare-bones RepairResource fixture — the normalizer will fill in defaults for
// anything missing (status → 'pending', priority → 'normal', etc), so tests
// only assert on the fields they care about.
function repairFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    repair_number: 'R-000001',
    customer_id: 10,
    issue_description: 'Cracked screen',
    status: 'pending',
    priority: 'normal',
    items: [],
    statusHistory: [],
    ...overrides,
  };
}

describe('RelayClient — repairs (T3)', () => {
  let fetchMock: FetchMock;
  let client: RelayClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as unknown as {fetch: FetchMock}).fetch = fetchMock;
    client = new RelayClient();
    client.configure({relayUrl: 'https://api.aeris.team', timeoutMs: 5000});
    client.setAuthToken('user-bearer');
  });

  function readBody(callIndex = 0): {
    action: string;
    params: Record<string, unknown>;
  } {
    const init = fetchMock.mock.calls[callIndex][1];
    const parsed = JSON.parse(init?.body as string);
    return {action: parsed.action, params: parsed.params};
  }

  describe('listRepairs', () => {
    it('forwards page/per_page/filters to repairs.list and normalizes the page', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.list', {
            data: [repairFixture(), repairFixture({id: 2, repair_number: 'R-2'})],
            meta: {current_page: 2, last_page: 5, per_page: 20, total: 42},
          }),
        ),
      );
      const page = await client.listRepairs(2, 20, {
        status: 'pending',
        customer_id: 10,
        date_from: '2026-01-01',
      });
      const sent = readBody();
      expect(sent.action).toBe('repairs.list');
      expect(sent.params.page).toBe(2);
      expect(sent.params.per_page).toBe(20);
      expect(sent.params.status).toBe('pending');
      expect(sent.params.customer_id).toBe(10);
      expect(sent.params.date_from).toBe('2026-01-01');
      expect(page.data).toHaveLength(2);
      expect(page.data[0].repair_number).toBe('R-000001');
      expect(page.meta.total).toBe(42);
    });

    it('returns an empty page on a NOT_FOUND envelope (dispatcher not yet wired)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.list', undefined, 'error', {
            code: 'NOT_FOUND',
            message: 'action not routed',
          }),
        ),
      );
      const page = await client.listRepairs(1, 20);
      expect(page.data).toEqual([]);
      expect(page.meta.current_page).toBe(1);
    });
  });

  describe('getRepairDetail', () => {
    it('unwraps {data:{...}} and normalizes RepairDetail with items + status_history', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.detail', {
            data: repairFixture({
              id: 7,
              items: [
                {
                  id: 1,
                  repair_id: 7,
                  item_name: 'Screen',
                  item_type: 'part',
                  quantity: 1,
                  unit_price: 199,
                  line_total: 199,
                  status: 'reserved',
                },
              ],
              statusHistory: [
                {
                  id: 1,
                  from_status: null,
                  to_status: 'pending',
                  changed_at: '2026-06-01T00:00:00Z',
                  user: {id: 1, name: 'Alice'},
                },
              ],
              customer: {id: 10, name: 'Bob', email: null, phone: null},
            }),
          }),
        ),
      );
      const detail = await client.getRepairDetail(7);
      const sent = readBody();
      expect(sent.action).toBe('repairs.detail');
      expect(sent.params.repair_id).toBe(7);
      expect(sent.params.id).toBe(7); // dispatcher-placeholder alias
      expect(detail).not.toBeNull();
      expect(detail!.id).toBe(7);
      expect(detail!.items).toHaveLength(1);
      expect(detail!.status_history).toHaveLength(1);
      expect(detail!.customer?.name).toBe('Bob');
    });

    it('returns null when the server replies NOT_FOUND', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.detail', undefined, 'error', {
            code: 'NOT_FOUND',
            message: 'record not found',
          }),
        ),
      );
      const detail = await client.getRepairDetail(999);
      expect(detail).toBeNull();
    });
  });

  describe('createRepair', () => {
    it('sends an Idempotency-Key header and normalizes to RepairDetail', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.create', {
            data: repairFixture({id: 55, customer: {id: 10, name: 'Bob'}}),
          }),
        ),
      );
      const created = await client.createRepair({
        customer_id: 10,
        issue_description: 'Cracked screen',
      });
      const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['Idempotency-Key']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      const sent = readBody();
      expect(sent.action).toBe('repairs.create');
      expect(sent.params.customer_id).toBe(10);
      expect(sent.params.issue_description).toBe('Cracked screen');
      expect(created.id).toBe(55);
      // RepairDetail includes items[] + status_history[] arrays.
      expect(Array.isArray(created.items)).toBe(true);
      expect(Array.isArray(created.status_history)).toBe(true);
    });

    it('retries on TIMEOUT and reuses the same Idempotency-Key', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(envelope('repairs.create', undefined, 'timeout')),
        )
        .mockResolvedValueOnce(
          jsonResponse(
            envelope('repairs.create', {data: repairFixture({id: 55})}),
          ),
        );
      await client.createRepair({
        customer_id: 10,
        issue_description: 'Cracked screen',
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const k1 = (fetchMock.mock.calls[0][1]?.headers as Record<string, string>)[
        'Idempotency-Key'
      ];
      const k2 = (fetchMock.mock.calls[1][1]?.headers as Record<string, string>)[
        'Idempotency-Key'
      ];
      expect(k1).toBe(k2);
    });
  });

  describe('updateRepair', () => {
    it('sends aliased {repair_id, id} params and the patch payload', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.update', {
            data: repairFixture({id: 7, diagnosis: 'Screen assembly'}),
          }),
        ),
      );
      const updated = await client.updateRepair(7, {
        diagnosis: 'Screen assembly',
        estimated_cost: 199,
      });
      const sent = readBody();
      expect(sent.action).toBe('repairs.update');
      expect(sent.params.repair_id).toBe(7);
      expect(sent.params.id).toBe(7);
      expect(sent.params.diagnosis).toBe('Screen assembly');
      expect(sent.params.estimated_cost).toBe(199);
      expect(updated.diagnosis).toBe('Screen assembly');
    });
  });

  describe('updateRepairStatus', () => {
    it('sends {repair_id, id, status, notes} to repairs.update-status', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.update-status', {
            data: repairFixture({id: 7, status: 'diagnosed'}),
          }),
        ),
      );
      await client.updateRepairStatus(7, 'diagnosed', 'Root cause found');
      const sent = readBody();
      expect(sent.action).toBe('repairs.update-status');
      expect(sent.params.repair_id).toBe(7);
      expect(sent.params.id).toBe(7);
      expect(sent.params.status).toBe('diagnosed');
      expect(sent.params.notes).toBe('Root cause found');
    });

    it('omits notes when not provided', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.update-status', {
            data: repairFixture({id: 7, status: 'ready'}),
          }),
        ),
      );
      await client.updateRepairStatus(7, 'ready');
      const sent = readBody();
      expect(sent.params.notes).toBeUndefined();
    });
  });

  describe('addRepairItem', () => {
    it('attaches an Idempotency-Key and does NOT send line_total', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.add-item', {
            data: repairFixture({
              id: 7,
              items: [
                {
                  id: 1,
                  repair_id: 7,
                  item_name: 'Screen',
                  item_type: 'part',
                  quantity: 1,
                  unit_price: 199,
                  line_total: 199,
                  status: 'reserved',
                },
              ],
            }),
          }),
        ),
      );
      await client.addRepairItem(7, {
        item_type: 'part',
        item_name: 'Screen',
        quantity: 1,
        unit_price: 199,
        product_id: 12,
      });
      const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['Idempotency-Key']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      const sent = readBody();
      expect(sent.action).toBe('repairs.add-item');
      expect(sent.params.repair_id).toBe(7);
      expect(sent.params.id).toBe(7);
      expect(sent.params.item_type).toBe('part');
      expect(sent.params.item_name).toBe('Screen');
      expect(sent.params.quantity).toBe(1);
      expect(sent.params.unit_price).toBe(199);
      expect(sent.params.product_id).toBe(12);
      // line_total MUST NOT be on the wire — server computes it.
      expect(sent.params.line_total).toBeUndefined();
    });
  });

  describe('removeRepairItem', () => {
    it('sends aliased {repair_id, item_id, id} params', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.remove-item', {data: repairFixture({id: 7})}),
        ),
      );
      await client.removeRepairItem(7, 3);
      const sent = readBody();
      expect(sent.action).toBe('repairs.remove-item');
      expect(sent.params.repair_id).toBe(7);
      expect(sent.params.id).toBe(7);
      expect(sent.params.item_id).toBe(3);
    });
  });

  describe('bulkUpdateRepairStatus', () => {
    it('canonical {succeeded, skipped} response passes through unchanged', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.bulk-status', {
            data: {succeeded: [1, 2], skipped: [3]},
          }),
        ),
      );
      const result = await client.bulkUpdateRepairStatus(
        [1, 2, 3],
        'in_progress',
      );
      expect(result.succeeded).toEqual([1, 2]);
      expect(result.skipped).toEqual([3]);
    });

    it('client-side diffs an array-of-repairs response against the requested ids', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.bulk-status', {
            data: [
              repairFixture({id: 1, status: 'in_progress'}),
              repairFixture({id: 2, status: 'in_progress'}),
            ],
          }),
        ),
      );
      const result = await client.bulkUpdateRepairStatus(
        [1, 2, 3],
        'in_progress',
      );
      expect(result.succeeded).toEqual([1, 2]);
      // 3 wasn't in the echoed rows so it's inferred as skipped.
      expect(result.skipped).toEqual([3]);
    });
  });

  describe('deleteRepair', () => {
    it('resolves without throwing on NOT_FOUND (already gone)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.delete', undefined, 'error', {
            code: 'NOT_FOUND',
            message: 'record not found',
          }),
        ),
      );
      await expect(client.deleteRepair(999)).resolves.toBeUndefined();
    });

    it('re-throws non-NOT_FOUND errors so the UI can show a banner', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.delete', undefined, 'error', {
            code: 'forbidden',
            message: 'Cannot delete repair with sale',
          }),
        ),
      );
      await expect(client.deleteRepair(7)).rejects.toBeInstanceOf(RelayError);
    });
  });

  describe('getPendingRepairsForCustomer', () => {
    it('returns [] when the dispatcher answers NOT_FOUND (action not routed yet)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.pending-for-customer', undefined, 'error', {
            code: 'NOT_FOUND',
            message: 'action not routed',
          }),
        ),
      );
      const list = await client.getPendingRepairsForCustomer(10);
      expect(list).toEqual([]);
    });

    it('normalizes the canonical {data:[...]} shape', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.pending-for-customer', {
            data: [
              {
                id: 1,
                repair_number: 'R-1',
                issue_description: 'Cracked screen',
                device_type: 'phone',
                brand: 'Acme',
                model: 'X1',
                estimated_cost: 199,
                final_cost: null,
                received_at: '2026-01-01T00:00:00Z',
              },
            ],
          }),
        ),
      );
      const list = await client.getPendingRepairsForCustomer(10);
      expect(list).toHaveLength(1);
      expect(list[0].repair_number).toBe('R-1');
    });

    it('falls back to the older {success, repairs:[...], count} shape', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.pending-for-customer', {
            success: true,
            count: 1,
            repairs: [
              {
                id: 1,
                repair_number: 'R-1',
                issue_description: 'Cracked screen',
                device_type: null,
                brand: null,
                model: null,
                estimated_cost: null,
                final_cost: null,
                received_at: null,
              },
            ],
          }),
        ),
      );
      const list = await client.getPendingRepairsForCustomer(10);
      expect(list).toHaveLength(1);
      expect(list[0].repair_number).toBe('R-1');
    });

    // COV-5: assert the aliased-id params concretely. If the dispatcher
    // wiring changes and `customer_id` gets renamed, we want a red test.
    it('sends aliased {customer_id, id} params to repairs.pending-for-customer', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('repairs.pending-for-customer', {data: []})),
      );
      await client.getPendingRepairsForCustomer(10);
      const sent = readBody();
      expect(sent.action).toBe('repairs.pending-for-customer');
      expect(sent.params.customer_id).toBe(10);
      expect(sent.params.id).toBe(10);
    });
  });

  // COV-1 — was missing entirely. status-history has an unusual shape (a
  // list of RepairStatusHistory entries with null-safe user), and the wire
  // uses aliased {repair_id, id} params.
  describe('getRepairStatusHistory', () => {
    it('sends aliased params and normalizes the history list', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.status-history', {
            data: [
              {
                id: 1,
                from_status: null,
                to_status: 'pending',
                notes: 'Intake',
                changed_at: '2026-07-02T08:00:00.000000Z',
                user: {id: 3, name: 'Sam K.'},
              },
              {
                id: 2,
                from_status: 'pending',
                to_status: 'ready',
                user: null, // deployment-flagged edge case
              },
            ],
          }),
        ),
      );
      const history = await client.getRepairStatusHistory(7);
      const sent = readBody();
      expect(sent.action).toBe('repairs.status-history');
      expect(sent.params.repair_id).toBe(7);
      expect(sent.params.id).toBe(7);
      expect(history).toHaveLength(2);
      expect(history[0].user).toEqual({id: 3, name: 'Sam K.'});
      // Null user null-safed by the normalizer to a stable placeholder.
      expect(history[1].user).toEqual({id: 0, name: 'Unknown user'});
    });

    it('resolves to [] on NOT_FOUND (dispatcher not yet wired)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.status-history', undefined, 'error', {
            code: 'NOT_FOUND',
            message: 'action not registered',
          }),
        ),
      );
      const history = await client.getRepairStatusHistory(7);
      expect(history).toEqual([]);
    });
  });

  // COV-2 — was missing entirely. updateRepairItem has a triple-aliased id
  // wire contract AND must NOT send line_total.
  describe('updateRepairItem', () => {
    it('sends {repair_id, id, item_id} plus patch fields and NO line_total', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.update-item', {
            data: repairFixture({
              id: 7,
              items: [
                {
                  id: 3,
                  repair_id: 7,
                  item_name: 'Screen',
                  item_type: 'part',
                  quantity: 2,
                  unit_price: 199,
                  line_total: 398,
                  status: 'installed',
                },
              ],
            }),
          }),
        ),
      );
      await client.updateRepairItem(7, 3, {
        quantity: 2,
        unit_price: 199,
        notes: 'ordered spare',
        status: 'installed',
      });
      const sent = readBody();
      expect(sent.action).toBe('repairs.update-item');
      expect(sent.params.repair_id).toBe(7);
      expect(sent.params.id).toBe(7);
      expect(sent.params.item_id).toBe(3);
      expect(sent.params.quantity).toBe(2);
      expect(sent.params.unit_price).toBe(199);
      expect(sent.params.notes).toBe('ordered spare');
      expect(sent.params.status).toBe('installed');
      // Server-computed — must NOT be on the wire.
      expect(sent.params.line_total).toBeUndefined();
    });
  });

  // COV-6 — retry test proves the SAME key is reused; this proves DIFFERENT
  // keys across separate calls. A regression that memoised the UUID at
  // module scope would go undetected without this test.
  describe('createRepair (distinct keys)', () => {
    it('mints a fresh Idempotency-Key on every separate call', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(envelope('repairs.create', {data: repairFixture({id: 1})})),
        )
        .mockResolvedValueOnce(
          jsonResponse(envelope('repairs.create', {data: repairFixture({id: 2})})),
        );
      await client.createRepair({customer_id: 10, issue_description: 'A'});
      await client.createRepair({customer_id: 10, issue_description: 'B'});
      const k1 = (fetchMock.mock.calls[0][1]?.headers as Record<string, string>)[
        'Idempotency-Key'
      ];
      const k2 = (fetchMock.mock.calls[1][1]?.headers as Record<string, string>)[
        'Idempotency-Key'
      ];
      expect(k1).toBeDefined();
      expect(k2).toBeDefined();
      expect(k1).not.toBe(k2);
    });
  });

  // COV-7 — write-persisted contract on updateRepair. Envelope with data:null
  // must reject rather than returning a synthetic repair.
  describe('updateRepair (failure)', () => {
    it('rejects when the envelope has data: null (assertWritePersisted)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('repairs.update', {data: null})),
      );
      await expect(
        client.updateRepair(7, {diagnosis: 'x'}),
      ).rejects.toThrow();
    });
  });

  // COV-8 — mirror the createRepair TIMEOUT retry test for addRepairItem so a
  // regression in the SALE_RETRY loop for this method surfaces immediately.
  describe('addRepairItem (retry)', () => {
    it('retries on TIMEOUT and reuses the same Idempotency-Key', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(envelope('repairs.add-item', undefined, 'timeout')),
        )
        .mockResolvedValueOnce(
          jsonResponse(
            envelope('repairs.add-item', {data: repairFixture({id: 7})}),
          ),
        );
      await client.addRepairItem(7, {
        item_type: 'part',
        item_name: 'Screen',
        quantity: 1,
        unit_price: 199,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const k1 = (fetchMock.mock.calls[0][1]?.headers as Record<string, string>)[
        'Idempotency-Key'
      ];
      const k2 = (fetchMock.mock.calls[1][1]?.headers as Record<string, string>)[
        'Idempotency-Key'
      ];
      expect(k1).toBe(k2);
    });
  });

  // T8 — createSale threads repair_id at the TOP LEVEL of the wire payload
  // (sibling to customer_id), matching Aeris2's ProcessSaleRequest field.
  // Both the presence and the absence cases are covered — the per-item
  // whitelist projection at RelayClient:620-627 would silently drop the
  // field if the mapping missed it.
  describe('createSale (T8 — repair_id threading)', () => {
    function readSaleBody(): Record<string, unknown> {
      const init = fetchMock.mock.calls[0][1];
      const body = init?.body as string | undefined;
      if (!body) throw new Error('no body sent');
      const parsed = JSON.parse(body);
      return (parsed.params ?? parsed) as Record<string, unknown>;
    }

    it('threads repair_id at the top level of the wire payload', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('sale.create', {
            id: 1,
            sale_number: 'S-1',
            total_cents: 100,
          }),
        ),
      );
      await client.createSale({
        items: [{product_id: 1, quantity: 1, unit_price_cents: 100}],
        payments: [{method: 'cash', amount_cents: 100}],
        customer_id: 42,
        repair_id: 7,
      });
      const sent = readSaleBody();
      expect(sent.repair_id).toBe(7);
      // Sibling to customer_id at the top level — NOT nested under items[].
      expect(sent.customer_id).toBe(42);
      const items = sent.items as Array<Record<string, unknown>>;
      expect(items[0].repair_id).toBeUndefined();
    });

    it('omits repair_id when not provided (normal retail sale)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('sale.create', {
            id: 1,
            sale_number: 'S-1',
            total_cents: 100,
          }),
        ),
      );
      await client.createSale({
        items: [{product_id: 1, quantity: 1, unit_price_cents: 100}],
        payments: [{method: 'cash', amount_cents: 100}],
      });
      const sent = readSaleBody();
      expect(sent.repair_id).toBeUndefined();
    });
  });

  // COV-4 — bulk-status assertions the earlier tests skipped: wire params,
  // notes on the wire, the older alias {updated_ids, skipped_ids}, the
  // "server acknowledged with empty succeeded+skipped" fallback.
  describe('bulkUpdateRepairStatus (params + fallbacks)', () => {
    it('sends {repair_ids, status, notes} on the wire', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.bulk-status', {
            data: {succeeded: [1, 2, 3], skipped: []},
          }),
        ),
      );
      await client.bulkUpdateRepairStatus([1, 2, 3], 'in_progress', 'Batch update');
      const sent = readBody();
      expect(sent.action).toBe('repairs.bulk-status');
      expect(sent.params.repair_ids).toEqual([1, 2, 3]);
      expect(sent.params.status).toBe('in_progress');
      expect(sent.params.notes).toBe('Batch update');
    });

    it('accepts the older {updated_ids, skipped_ids} alias shape', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.bulk-status', {
            data: {updated_ids: [1], skipped_ids: [2]},
          }),
        ),
      );
      const result = await client.bulkUpdateRepairStatus([1, 2], 'ready');
      expect(result.succeeded).toEqual([1]);
      expect(result.skipped).toEqual([2]);
    });

    it('empty succeeded + empty skipped populates skipped from requested (C4)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          envelope('repairs.bulk-status', {data: {succeeded: [], skipped: []}}),
        ),
      );
      const result = await client.bulkUpdateRepairStatus([1, 2, 3], 'ready');
      expect(result.succeeded).toEqual([]);
      expect(result.skipped).toEqual([1, 2, 3]);
    });

    it('unusable response shape falls back to all-skipped', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('repairs.bulk-status', {data: {}})),
      );
      const result = await client.bulkUpdateRepairStatus([1, 2, 3], 'ready');
      expect(result.succeeded).toEqual([]);
      expect(result.skipped).toEqual([1, 2, 3]);
    });
  });
});
