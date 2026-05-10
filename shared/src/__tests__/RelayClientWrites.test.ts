import {RelayClient, RelayError} from '../relay';

type FetchMock = jest.Mock<Promise<Response>, [RequestInfo, RequestInit?]>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

// Mirror the polyfill in RelayClient.test.ts so adjustStock's idempotency key
// generation works under older Node test runners.
if (!(globalThis as {crypto?: {randomUUID?: () => string}}).crypto?.randomUUID) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require('crypto');
  (globalThis as {crypto: {randomUUID: () => string}}).crypto = {
    randomUUID: () => nodeCrypto.randomUUID(),
  };
}

function envelope(action: string, data: unknown, status: 'ok' | 'error' | 'timeout' = 'ok', error?: {code: string; message: string}) {
  return {
    correlation_id: `cid-${action}`,
    action,
    status,
    ...(data !== undefined ? {data} : {}),
    ...(error ? {error} : {}),
  };
}

describe('RelayClient — B3 write paths', () => {
  let fetchMock: FetchMock;
  let client: RelayClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as unknown as {fetch: FetchMock}).fetch = fetchMock;
    client = new RelayClient();
    client.configure({relayUrl: 'https://api.aeris.team', timeoutMs: 5000});
    client.setAuthToken('user-bearer');
  });

  function readBody(callIndex = 0): {action: string; params: Record<string, unknown>} {
    const init = fetchMock.mock.calls[callIndex][1];
    const parsed = JSON.parse(init?.body as string);
    return {action: parsed.action, params: parsed.params};
  }

  describe('createSale gst_applicable per-line tax_rate (#C2)', () => {
    function relayEnvelope(data: unknown, action = 'sale.create') {
      return {correlation_id: 'cid-test', action, status: 'ok' as const, data};
    }

    it('flags gst_applicable: true when tax_rate is 10', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(relayEnvelope({id: 1, sale_number: 'S-1', total_cents: 1100})),
      );
      await client.createSale({
        items: [{product_id: 1, quantity: 1, unit_price_cents: 1100, tax_rate: 10}],
        payments: [{method: 'cash', amount_cents: 1100}],
      });
      const items = (readBody().params.items as Array<Record<string, unknown>>);
      expect(items[0].gst_applicable).toBe(true);
    });

    it('flags gst_applicable: false when tax_rate is 0 (GST-free)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(relayEnvelope({id: 1, sale_number: 'S-1', total_cents: 500})),
      );
      await client.createSale({
        items: [{product_id: 1, quantity: 1, unit_price_cents: 500, tax_rate: 0}],
        payments: [{method: 'cash', amount_cents: 500}],
      });
      const items = (readBody().params.items as Array<Record<string, unknown>>);
      expect(items[0].gst_applicable).toBe(false);
    });

    it('defaults to gst_applicable: true when tax_rate is undefined', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(relayEnvelope({id: 1, sale_number: 'S-1', total_cents: 1100})),
      );
      await client.createSale({
        items: [{product_id: 1, quantity: 1, unit_price_cents: 1100}],
        payments: [{method: 'cash', amount_cents: 1100}],
      });
      const items = (readBody().params.items as Array<Record<string, unknown>>);
      expect(items[0].gst_applicable).toBe(true);
    });

    it('derives gst_applicable per-line in mixed carts', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(relayEnvelope({id: 1, sale_number: 'S-1', total_cents: 1600})),
      );
      await client.createSale({
        items: [
          {product_id: 1, quantity: 1, unit_price_cents: 1100, tax_rate: 10},
          {product_id: 2, quantity: 1, unit_price_cents: 500, tax_rate: 0},
        ],
        payments: [{method: 'cash', amount_cents: 1600}],
      });
      const items = (readBody().params.items as Array<Record<string, unknown>>);
      expect(items[0].gst_applicable).toBe(true);
      expect(items[1].gst_applicable).toBe(false);
    });
  });

  describe('toCustomerWirePayload / toProductWirePayload passthrough (#H3)', () => {
    it('passes unknown CustomerCreateInput fields through to the wire payload', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('customers.create', {data: {id: 1, first_name: 'Ada'}})),
      );
      // loyalty_tier isn't in the typed input today; passthrough must still ship it.
      await client.createCustomer({
        first_name: 'Ada',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({loyalty_tier: 'gold'} as any),
      });
      const sent = readBody();
      expect(sent.params.loyalty_tier).toBe('gold');
    });

    it('strips credit_limit_cents and re-emits as dollars (no leakage)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('customers.create', {data: {id: 1, first_name: 'Ada'}})),
      );
      await client.createCustomer({first_name: 'Ada', credit_limit_cents: 25050});
      const sent = readBody();
      expect(sent.params.credit_limit).toBe(250.5);
      expect(sent.params.credit_limit_cents).toBeUndefined();
    });

    it('passes unknown ProductCreateInput fields through to the wire payload', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('products.create', {
          data: {id: 5, name: 'Widget', sku: 'W-1', price: 19.99},
        })),
      );
      await client.createProduct({
        name: 'Widget',
        sku: 'W-1',
        category_id: 3,
        base_price_cents: 1999,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({brand: 'Acme'} as any),
      });
      const sent = readBody();
      expect(sent.params.brand).toBe('Acme');
    });

    it('strips base_price_cents / cost_price_cents and re-emits as dollar fields only', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('products.create', {
          data: {id: 5, name: 'Widget', sku: 'W-1', price: 19.99},
        })),
      );
      await client.createProduct({
        name: 'Widget',
        sku: 'W-1',
        category_id: 3,
        base_price_cents: 1999,
        cost_price_cents: 1200,
      });
      const sent = readBody();
      expect(sent.params.base_price).toBe(19.99);
      expect(sent.params.cost_price).toBe(12.0);
      expect(sent.params.base_price_cents).toBeUndefined();
      expect(sent.params.cost_price_cents).toBeUndefined();
    });
  });

  describe('createCustomer', () => {
    it('sends customer.create with credit_limit in dollars and returns a normalized Customer', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('customers.create', {
          data: {id: 12, first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com'},
        })),
      );
      const created = await client.createCustomer({
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'ada@example.com',
        credit_limit_cents: 50000,
      });
      const sent = readBody();
      expect(sent.action).toBe('customers.create');
      expect(sent.params.first_name).toBe('Ada');
      expect(sent.params.email).toBe('ada@example.com');
      expect(sent.params.credit_limit).toBe(500);
      expect(created.id).toBe(12);
      expect(created.email).toBe('ada@example.com');
    });

    it('surfaces a server validation error as a RelayError', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('customers.create', undefined, 'error', {
          code: 'validation_failed',
          message: 'first_name is required',
        })),
      );
      await expect(
        client.createCustomer({company: null}),
      ).rejects.toBeInstanceOf(RelayError);
    });

    it('attaches an Idempotency-Key header on customers.create', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('customers.create', {data: {id: 1, first_name: 'Ada'}})),
      );
      await client.createCustomer({first_name: 'Ada'});
      const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['Idempotency-Key']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('reuses the same Idempotency-Key on transient retry', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(envelope('customers.create', undefined, 'timeout')))
        .mockResolvedValueOnce(
          jsonResponse(envelope('customers.create', {data: {id: 2, first_name: 'Ada'}})),
        );
      await client.createCustomer({first_name: 'Ada'});
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const k1 = (fetchMock.mock.calls[0][1]?.headers as Record<string, string>)['Idempotency-Key'];
      const k2 = (fetchMock.mock.calls[1][1]?.headers as Record<string, string>)['Idempotency-Key'];
      expect(k1).toBe(k2);
    });
  });

  describe('updateCustomer', () => {
    it('sends customers.update with id alias + customer_id and returns updated entity', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('customers.update', {
          data: {id: 7, first_name: 'New', last_name: 'Name'},
        })),
      );
      const updated = await client.updateCustomer(7, {first_name: 'New'});
      const sent = readBody();
      expect(sent.params.id).toBe(7);
      expect(sent.params.customer_id).toBe(7);
      expect(sent.params.first_name).toBe('New');
      expect(updated.first_name).toBe('New');
    });
  });

  describe('deleteCustomer', () => {
    it('returns {ok: true} when the server returns a noContent envelope', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('customers.delete', null)),
      );
      const result = await client.deleteCustomer(99);
      expect(result).toEqual({ok: true});
      const sent = readBody();
      expect(sent.action).toBe('customers.delete');
      expect(sent.params.id).toBe(99);
      expect(sent.params.customer_id).toBe(99);
    });

    it('surfaces forbidden errors so the UI can show a banner', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('customers.delete', undefined, 'error', {
          code: 'forbidden',
          message: 'Cannot delete customer with recent orders',
        })),
      );
      await expect(client.deleteCustomer(7)).rejects.toMatchObject({
        code: 'forbidden',
      });
    });
  });

  describe('createProduct', () => {
    it('converts cents → dollar fields and returns a normalized Product', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('products.create', {
          data: {id: 5, name: 'Widget', sku: 'W-1', price: 19.99, stock_quantity: 0},
        })),
      );
      const created = await client.createProduct({
        name: 'Widget',
        sku: 'W-1',
        category_id: 3,
        base_price_cents: 1999,
        cost_price_cents: 1200,
      });
      const sent = readBody();
      expect(sent.params.base_price).toBe(19.99);
      expect(sent.params.cost_price).toBe(12.0);
      expect(sent.params.category_id).toBe(3);
      expect(created.id).toBe(5);
      expect(created.price_cents).toBe(1999);
    });

    it('omits cost_price when not supplied', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('products.create', {
          data: {id: 5, name: 'Widget', sku: 'W-1', price: 19.99},
        })),
      );
      await client.createProduct({
        name: 'Widget',
        sku: 'W-1',
        category_id: 3,
        base_price_cents: 1999,
      });
      const sent = readBody();
      expect(sent.params.cost_price).toBeUndefined();
    });

    it('attaches an Idempotency-Key header on products.create', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('products.create', {
          data: {id: 5, name: 'Widget', sku: 'W-1', price: 19.99},
        })),
      );
      await client.createProduct({
        name: 'Widget',
        sku: 'W-1',
        category_id: 3,
        base_price_cents: 1999,
      });
      const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['Idempotency-Key']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('reuses the same Idempotency-Key on transient retry', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(envelope('products.create', undefined, 'timeout')))
        .mockResolvedValueOnce(
          jsonResponse(envelope('products.create', {
            data: {id: 5, name: 'Widget', sku: 'W-1', price: 19.99},
          })),
        );
      await client.createProduct({
        name: 'Widget',
        sku: 'W-1',
        category_id: 3,
        base_price_cents: 1999,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const k1 = (fetchMock.mock.calls[0][1]?.headers as Record<string, string>)['Idempotency-Key'];
      const k2 = (fetchMock.mock.calls[1][1]?.headers as Record<string, string>)['Idempotency-Key'];
      expect(k1).toBe(k2);
    });
  });

  describe('updateProduct', () => {
    it('sends products.update with id alias and partial patch', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('products.update', {
          data: {id: 11, name: 'Updated', sku: 'U-1', price: 25.0},
        })),
      );
      const updated = await client.updateProduct(11, {name: 'Updated'});
      const sent = readBody();
      expect(sent.action).toBe('products.update');
      expect(sent.params.id).toBe(11);
      expect(sent.params.product_id).toBe(11);
      expect(sent.params.name).toBe('Updated');
      expect(updated.name).toBe('Updated');
    });
  });

  describe('adjustStock', () => {
    it('attaches an Idempotency-Key and returns the normalized adjustment', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('inventory.adjust-stock', {
          data: {
            product_id: 4,
            previous_quantity: 10,
            new_quantity: 8,
            adjustment: -2,
            reason: 'damaged_goods',
          },
        })),
      );
      const result = await client.adjustStock({
        product_id: 4,
        adjustment: -2,
        reason: 'damaged_goods',
        notes: 'broken in transit',
      });
      const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['Idempotency-Key']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      const sent = readBody();
      expect(sent.action).toBe('inventory.adjust-stock');
      expect(sent.params.product_id).toBe(4);
      expect(sent.params.adjustment).toBe(-2);
      expect(sent.params.reason).toBe('damaged_goods');
      expect(sent.params.notes).toBe('broken in transit');
      expect(result).toEqual({
        product_id: 4,
        previous_quantity: 10,
        new_quantity: 8,
        adjustment: -2,
        reason: 'damaged_goods',
      });
    });

    it('retries on relay TIMEOUT and reuses the same Idempotency-Key', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(envelope('inventory.adjust-stock', undefined, 'timeout')))
        .mockResolvedValueOnce(
          jsonResponse(envelope('inventory.adjust-stock', {
            data: {
              product_id: 4,
              previous_quantity: 10,
              new_quantity: 12,
              adjustment: 2,
              reason: 'found_stock',
            },
          })),
        );
      await client.adjustStock({product_id: 4, adjustment: 2, reason: 'found_stock'});
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const k1 = (fetchMock.mock.calls[0][1]?.headers as Record<string, string>)['Idempotency-Key'];
      const k2 = (fetchMock.mock.calls[1][1]?.headers as Record<string, string>)['Idempotency-Key'];
      expect(k1).toBe(k2);
    });

    it('does NOT retry on a deterministic validation failure', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('inventory.adjust-stock', undefined, 'error', {
          code: 'validation_failed',
          message: 'Adjustment would result in negative stock',
        })),
      );
      await expect(
        client.adjustStock({product_id: 4, adjustment: -100, reason: 'count_correction'}),
      ).rejects.toMatchObject({code: 'validation_failed'});
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDailyZReport', () => {
    it('converts dollar totals to cents and reshapes the breakdowns', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(envelope('sales.daily-summary', {
          data: {
            date: '2026-05-08',
            user_id: 1,
            total_sales: 5,
            completed_sales: 4,
            pending_sales: 1,
            total_revenue: 1234.56,
            total_gst: 112.23,
            total_discount: 10.0,
            unique_customers: 3,
            total_items_sold: 9,
            average_sale_value: 308.64,
            payment_method_breakdown: {cash: 500.0, card: 734.56},
            sales_by_staff: {Alice: 3, Bob: 1},
            hourly_breakdown: {'09': 1, '14': 3},
            sales_by_status: {completed: 4, pending: 1},
          },
        })),
      );
      const report = await client.getDailyZReport('2026-05-08');
      const sent = readBody();
      expect(sent.action).toBe('sales.daily-summary');
      expect(sent.params.date).toBe('2026-05-08');
      expect(report.total_revenue_cents).toBe(123456);
      expect(report.total_gst_cents).toBe(11223);
      expect(report.average_sale_cents).toBe(30864);
      expect(report.payment_method_breakdown).toEqual({cash: 50000, card: 73456});
      expect(report.sales_by_staff).toEqual({Alice: 3, Bob: 1});
    });

    it('retries an idempotent read on transport 504 then returns the result', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({message: 'gateway timeout'}, 504))
        .mockResolvedValueOnce(
          jsonResponse(envelope('sales.daily-summary', {
            data: {
              date: '2026-05-08',
              user_id: null,
              total_sales: 0,
              completed_sales: 0,
              pending_sales: 0,
              total_revenue: 0,
              total_gst: 0,
              total_discount: 0,
              unique_customers: 0,
              total_items_sold: 0,
              average_sale_value: 0,
              payment_method_breakdown: {},
              sales_by_staff: {},
              hourly_breakdown: {},
              sales_by_status: {},
            },
          })),
        );
      const report = await client.getDailyZReport();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(report.user_id).toBeNull();
      expect(report.total_revenue_cents).toBe(0);
    });
  });
});
