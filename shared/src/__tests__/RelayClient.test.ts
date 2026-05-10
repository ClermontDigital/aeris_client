import {RelayClient, RelayError} from '../relay';

type FetchMock = jest.Mock<Promise<Response>, [RequestInfo, RequestInit?]>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

// Polyfill globalThis.crypto.randomUUID for the Node test environment.
// Node 20+ has it natively; older Node versions running ts-jest may not.
if (!(globalThis as {crypto?: {randomUUID?: () => string}}).crypto?.randomUUID) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require('crypto');
  (globalThis as {crypto: {randomUUID: () => string}}).crypto = {
    randomUUID: () => nodeCrypto.randomUUID(),
  };
}

describe('RelayClient', () => {
  let fetchMock: FetchMock;
  let client: RelayClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as unknown as {fetch: FetchMock}).fetch = fetchMock;
    client = new RelayClient();
    client.configure({
      relayUrl: 'https://api.aeris.team',
      timeoutMs: 5000,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('relay mode', () => {
    it('posts to /api/relay/rpc with action and unwraps data on ok', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          correlation_id: 'cid-1',
          action: 'auth.login',
          status: 'ok',
          data: {access_token: 'a', token_type: 'bearer', expires_at: '2099-01-01T00:00:00Z', user: {id: 1, name: 'x', email: 'x@y', role: 'admin', location_id: null}},
          duration_ms: 50,
        }),
      );

      const auth = await client.login('a@b.c', 'p');
      expect(auth.access_token).toBe('a');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.aeris.team/api/relay/rpc');
      const body = JSON.parse(init?.body as string);
      expect(body.action).toBe('auth.login');
      expect(body.timeout).toBeGreaterThan(0);
    });

    it('also unwraps data when status is the spec-doc value "success"', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          correlation_id: 'cid-2',
          action: 'products.search',
          status: 'success',
          data: {data: [], meta: {current_page: 1, last_page: 1, per_page: 20, total: 0}},
        }),
      );
      const result = await client.searchProducts('widget');
      expect(result.data).toEqual([]);
    });

    it('throws RelayError preserving correlation_id on error envelope', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          correlation_id: 'cid-3',
          action: 'sale.create',
          status: 'error',
          error: {code: 'INSUFFICIENT_STOCK', message: 'Out of stock'},
        }),
      );

      await expect(
        client.createSale({items: [], payments: []}),
      ).rejects.toMatchObject({
        name: 'RelayError',
        code: 'INSUFFICIENT_STOCK',
        correlationId: 'cid-3',
      });
    });

    it('throws RelayError(TIMEOUT) on timeout envelope', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          jsonResponse({
            correlation_id: 'cid-4',
            action: 'dashboard.summary',
            status: 'timeout',
          }),
        ),
      );

      try {
        await client.getDailySummary();
        fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(RelayError);
        expect((e as RelayError).code).toBe('TIMEOUT');
        expect((e as RelayError).correlationId).toBe('cid-4');
      }
    });

    it('returns null from getProductByBarcode when relay reports NOT_FOUND', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          correlation_id: 'cid-5',
          action: 'products.barcode',
          status: 'error',
          error: {code: 'NOT_FOUND', message: 'no such product'},
        }),
      );
      const result = await client.getProductByBarcode('99999');
      expect(result).toBeNull();
    });

    it('fires onUnauthorized on relay 401', async () => {
      const onUnauth = jest.fn();
      client.setOnUnauthorized(onUnauth);
      fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
      await expect(
        client.getDailySummary(),
      ).rejects.toThrow(/Authentication expired/);
      expect(onUnauth).toHaveBeenCalledTimes(1);
    });

    it('sends a server-side timeout that is below the client buffer', async () => {
      client.configure({timeoutMs: 10000});
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          correlation_id: 'cid-6',
          action: 'dashboard.summary',
          status: 'ok',
          data: {date: '', sales_count: 0, revenue_cents: 0, items_sold: 0, average_sale_cents: 0, top_products: []},
        }),
      );
      await client.getDailySummary();
      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
      // 10s client → server-side timeout in seconds, capped at 30
      expect(body.timeout).toBe(10);
    });
  });

  describe('searchProducts', () => {
    it('returns an empty page for an empty query without hitting the network', async () => {
      const result = await client.searchProducts('   ');
      expect(result).toEqual({
        data: [],
        meta: {current_page: 1, last_page: 1, per_page: 20, total: 0},
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('createSale idempotency + retry (relay)', () => {
    const saleData = {
      items: [{product_id: 1, quantity: 1, unit_price_cents: 100}],
      payments: [{method: 'cash', amount_cents: 100}],
    };
    const okEnvelope = {
      correlation_id: 'cid-sale',
      action: 'sale.create',
      status: 'ok' as const,
      data: {sale_id: 1, sale_number: 'S-1', total_cents: 100},
    };

    it('attaches an Idempotency-Key header in relay mode', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(okEnvelope));
      await client.createSale(saleData);
      const headers = fetchMock.mock.calls[0][1]?.headers as Record<
        string,
        string
      >;
      expect(headers['Idempotency-Key']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('retries on relay TIMEOUT envelope but not on a relay application error', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            correlation_id: 'cid-1',
            action: 'sale.create',
            status: 'timeout',
          }),
        )
        .mockResolvedValueOnce(jsonResponse(okEnvelope));

      await client.createSale(saleData);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Reset and confirm a non-timeout relay error does NOT retry.
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          correlation_id: 'cid-2',
          action: 'sale.create',
          status: 'error',
          error: {code: 'INSUFFICIENT_STOCK', message: 'oos'},
        }),
      );
      await expect(client.createSale(saleData)).rejects.toMatchObject({
        name: 'RelayError',
        code: 'INSUFFICIENT_STOCK',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('relay HTTP errors (no envelope)', () => {
    it('throws on HTTP 404 instead of swallowing as "not found" — relay 404 means no service config', async () => {
      // Per the marketplace contract, HTTP 404 from /api/relay/rpc means
      // "no push-mode relay_service_config for this service". That MUST
      // surface as an error, not silently return null, otherwise we'd mask
      // a misconfigured deployment as a missing barcode.
      fetchMock.mockResolvedValueOnce(
        jsonResponse({message: 'no relay_service_config for products'}, 404),
      );
      await expect(client.getProductByBarcode('123')).rejects.toMatchObject({
        status: 404,
      });
    });

    it('relay envelope NOT_FOUND code DOES return null from getProductByBarcode', async () => {
      // Contrast with the test above: an envelope-shaped error with
      // code=NOT_FOUND means "the deployment received the request and
      // reported the record is absent" — that's the correct null path.
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          correlation_id: 'cid-nf',
          action: 'products.barcode',
          status: 'error',
          error: {code: 'NOT_FOUND', message: 'no such product'},
        }),
      );
      expect(await client.getProductByBarcode('123')).toBeNull();
    });

    it('throws on HTTP 400 (validation) without retry', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({message: 'action too long'}, 400),
      );
      await expect(client.getDailySummary()).rejects.toMatchObject({
        status: 400,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('treats HTTP 504 as retryable for createSale and reuses the idempotency key', async () => {
      const okEnv = {
        correlation_id: 'cid-ok',
        action: 'sale.create',
        status: 'ok' as const,
        data: {sale_id: 1, sale_number: 'S-1', total_cents: 100},
      };
      fetchMock
        .mockResolvedValueOnce(jsonResponse({message: 'gateway timeout'}, 504))
        .mockResolvedValueOnce(jsonResponse(okEnv));

      await client.createSale({
        items: [{product_id: 1, quantity: 1, unit_price_cents: 100}],
        payments: [{method: 'cash', amount_cents: 100}],
      });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const k1 = (fetchMock.mock.calls[0][1]?.headers as Record<
        string,
        string
      >)['Idempotency-Key'];
      const k2 = (fetchMock.mock.calls[1][1]?.headers as Record<
        string,
        string
      >)['Idempotency-Key'];
      expect(k1).toBeTruthy();
      expect(k2).toBe(k1);
    });

    it('rejects a parseable but non-envelope-shaped JSON body as a transport error', async () => {
      // Body parses as JSON but lacks {correlation_id, status} — this used
      // to silently fall through and return undefined cast to T. Now it
      // must throw with the HTTP status preserved.
      fetchMock.mockResolvedValueOnce(jsonResponse({hello: 'world'}, 200));
      await expect(client.getDailySummary()).rejects.toMatchObject({
        status: 200,
      });
    });
  });

  describe('getStock', () => {
    it('hits inventory.stock action in relay mode', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          correlation_id: 'cid-7',
          action: 'inventory.stock',
          status: 'ok',
          data: {product_id: 42, on_hand: 10, committed: 2, available: 8, levels: []},
        }),
      );
      const snap = await client.getStock(42, 1);
      expect(snap.available).toBe(8);
      const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
      expect(body.action).toBe('inventory.stock');
      expect(body.params.product_id).toBe(42);
      expect(body.params.location_id).toBe(1);
    });
  });

  describe('workspace code & token isolation', () => {
    it('sends X-Aeris-Workspace header when workspaceCode is configured', async () => {
      client.configure({workspaceCode: 'acme-prod'});
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          correlation_id: 'cid-ws',
          action: 'dashboard.summary',
          status: 'ok',
          data: {date: '', sales_count: 0, revenue_cents: 0, items_sold: 0, average_sale_cents: 0, top_products: []},
        }),
      );
      await client.getDailySummary();
      const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['X-Aeris-Workspace']).toBe('acme-prod');
    });

    it('relay auth.login sends X-Aeris-Workspace and NO Authorization header', async () => {
      client.configure({workspaceCode: 'acme-prod'});
      // Even with a stale token, login must clear it pre-call.
      client.setAuthToken('stale-token');
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          correlation_id: 'cid-login',
          action: 'auth.login',
          status: 'ok',
          data: {access_token: 'new', token_type: 'bearer', expires_at: '2099-01-01T00:00:00Z', user: {id: 1, name: 'x', email: 'x@y', role: 'admin', location_id: null}},
        }),
      );
      await client.login('a@b.c', 'p');
      const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['X-Aeris-Workspace']).toBe('acme-prod');
      expect(headers).not.toHaveProperty('Authorization');
    });

    it('login() clears authToken in-memory even when setAuthToken("stale") was called first', async () => {
      client.configure({workspaceCode: 'acme-prod'});
      client.setAuthToken('stale-token');
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          correlation_id: 'cid-login2',
          action: 'auth.login',
          status: 'ok',
          data: {access_token: 'fresh', token_type: 'bearer', expires_at: '2099-01-01T00:00:00Z', user: {id: 1, name: 'x', email: 'x@y', role: 'admin', location_id: null}},
        }),
      );
      await client.login('a@b.c', 'p');
      const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers).not.toHaveProperty('Authorization');
    });

    it('authenticated relay call sends both X-Aeris-Workspace and Authorization', async () => {
      client.configure({workspaceCode: 'acme-prod'});
      client.setAuthToken('user-token');
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          correlation_id: 'cid-auth',
          action: 'dashboard.summary',
          status: 'ok',
          data: {date: '', sales_count: 0, revenue_cents: 0, items_sold: 0, average_sale_cents: 0, top_products: []},
        }),
      );
      await client.getDailySummary();
      const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['X-Aeris-Workspace']).toBe('acme-prod');
      expect(headers['Authorization']).toBe('Bearer user-token');
    });

    it('configure() ignores an invalid workspaceCode (defense-in-depth)', async () => {
      // Quiet the expected console.warn so test output stays clean.
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      client.configure({workspaceCode: 'A!!bad'}); // fails regex
      expect(client.getWorkspaceCode()).toBe('');
      // Run a relay call and assert no header leaked.
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          correlation_id: 'cid-bad',
          action: 'dashboard.summary',
          status: 'ok',
          data: {date: '', sales_count: 0, revenue_cents: 0, items_sold: 0, average_sale_cents: 0, top_products: []},
        }),
      );
      await client.getDailySummary();
      const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers).not.toHaveProperty('X-Aeris-Workspace');
      warnSpy.mockRestore();
    });
  });

  describe('createSale dollar-shape payload', () => {
    beforeEach(() => {
      client.configure({workspaceCode: 'aeris-demo'});
      client.setAuthToken('user-bearer');
    });

    function relayEnvelope(data: unknown, action = 'sale.create') {
      return {
        correlation_id: 'cid-test',
        action,
        status: 'ok' as const,
        data,
      };
    }

    function readSentBody(): Record<string, unknown> {
      const init = fetchMock.mock.calls[0][1];
      const body = init?.body as string | undefined;
      if (!body) throw new Error('no body sent');
      const parsed = JSON.parse(body);
      return (parsed.params ?? parsed) as Record<string, unknown>;
    }

    it('converts cents → dollars and includes subtotal/tax_amount/total_amount', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(relayEnvelope({id: 42, sale_number: 'S-42', total_cents: 1100})),
      );

      await client.createSale({
        items: [{product_id: 1, quantity: 2, unit_price_cents: 550}],
        payments: [{method: 'cash', amount_cents: 1100}],
      });

      const sent = readSentBody();
      expect(sent.subtotal).toBeCloseTo(10.0, 2);
      expect(sent.tax_amount).toBeCloseTo(1.0, 2);
      expect(sent.total_amount).toBe(11.0);

      const items = sent.items as Array<Record<string, unknown>>;
      expect(items[0].unit_price).toBe(5.5);
      expect(items[0].gst_applicable).toBe(true);
      expect(items[0].discount_amount).toBe(0);
      expect(items[0].quantity).toBe(2);

      const payments = sent.payments as Array<Record<string, unknown>>;
      expect(payments[0].amount).toBe(11.0);
      expect(payments[0].method).toBe('cash');
    });

    it('passes customer_id, cart-level discount_amount, and notes through', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(relayEnvelope({id: 1, sale_number: 'S-1', total_cents: 100})),
      );

      await client.createSale({
        items: [{product_id: 9, quantity: 1, unit_price_cents: 200}],
        payments: [{method: 'eftpos', amount_cents: 100}],
        customer_id: 7,
        discount_cents: 100,
        notes: 'staff comp',
      });

      const sent = readSentBody();
      expect(sent.customer_id).toBe(7);
      expect(sent.discount_amount).toBe(1.0);
      expect(sent.notes).toBe('staff comp');
    });

    it('omits optional fields when not provided', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(relayEnvelope({id: 1, sale_number: 'S-1', total_cents: 100})),
      );

      await client.createSale({
        items: [{product_id: 1, quantity: 1, unit_price_cents: 100}],
        payments: [{method: 'cash', amount_cents: 100}],
      });

      const sent = readSentBody();
      expect(sent.customer_id).toBeUndefined();
      expect(sent.discount_amount).toBeUndefined();
      expect(sent.notes).toBeUndefined();
    });

    it('passes payment reference through when provided', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(relayEnvelope({id: 1, sale_number: 'S-1', total_cents: 100})),
      );

      await client.createSale({
        items: [{product_id: 1, quantity: 1, unit_price_cents: 100}],
        payments: [{method: 'eftpos', amount_cents: 100, reference: 'EFT-99'}],
      });

      const payments = (readSentBody().payments as Array<
        Record<string, unknown>
      >);
      expect(payments[0].reference).toBe('EFT-99');
    });

    it('maps server `id` to `sale_id` in the returned shape', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          relayEnvelope({id: 99, sale_number: 'S-99', total_cents: 100}),
        ),
      );

      const result = await client.createSale({
        items: [{product_id: 1, quantity: 1, unit_price_cents: 100}],
        payments: [{method: 'cash', amount_cents: 100}],
      });

      expect(result.sale_id).toBe(99);
      expect(result.sale_number).toBe('S-99');
      expect(result.total_cents).toBe(100);
    });

    it('also accepts `sale_id` directly (legacy / alternate server shape)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(
          relayEnvelope({sale_id: 7, sale_number: 'S-7', total_cents: 50}),
        ),
      );

      const result = await client.createSale({
        items: [{product_id: 1, quantity: 1, unit_price_cents: 50}],
        payments: [{method: 'cash', amount_cents: 50}],
      });

      expect(result.sale_id).toBe(7);
    });

    it('converts item-level discount_cents → discount_amount in dollars', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(relayEnvelope({id: 1, sale_number: 'S-1', total_cents: 450})),
      );

      await client.createSale({
        items: [
          {
            product_id: 1,
            quantity: 1,
            unit_price_cents: 500,
            discount_cents: 50,
          },
        ],
        payments: [{method: 'cash', amount_cents: 450}],
      });

      const items = readSentBody().items as Array<Record<string, unknown>>;
      expect(items[0].discount_amount).toBe(0.5);
    });

    it('still attaches an Idempotency-Key header on the relay request', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(relayEnvelope({id: 1, sale_number: 'S-1', total_cents: 100})),
      );

      await client.createSale({
        items: [{product_id: 1, quantity: 1, unit_price_cents: 100}],
        payments: [{method: 'cash', amount_cents: 100}],
      });

      const headers = (fetchMock.mock.calls[0][1]?.headers ?? {}) as Record<
        string,
        string
      >;
      expect(headers['Idempotency-Key']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });
});
