import {ApiClient, RelayError} from '../services/ApiClient';

type FetchMock = jest.Mock<Promise<Response>, [RequestInfo, RequestInit?]>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

describe('ApiClient', () => {
  let fetchMock: FetchMock;
  let client: ApiClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as unknown as {fetch: FetchMock}).fetch = fetchMock;
    client = new ApiClient();
    client.configure({
      baseUrl: 'http://aeris.local:8000',
      relayUrl: 'https://api.aeris.team',
      mode: 'direct',
      timeoutMs: 5000,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('direct mode', () => {
    it('hits the configured baseUrl with bearer token', async () => {
      client.setAuthToken('tok');
      fetchMock.mockResolvedValueOnce(
        jsonResponse({id: 1, name: 'Cat'}),
      );

      await client.getCategories();

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://aeris.local:8000/api/v1/products/categories');
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        'Bearer tok',
      );
    });

    it('returns null from getProductByBarcode on 404', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({message: 'not found'}, 404));
      const result = await client.getProductByBarcode('123');
      expect(result).toBeNull();
    });

    it('throws on non-404 errors from getProductByBarcode', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({message: 'oops'}, 500));
      await expect(client.getProductByBarcode('123')).rejects.toThrow(
        /Request failed \(500\)/,
      );
    });

    it('fires onUnauthorized and throws on 401', async () => {
      const onUnauth = jest.fn();
      client.setOnUnauthorized(onUnauth);
      client.setAuthToken('tok');
      fetchMock.mockResolvedValueOnce(jsonResponse({message: 'no'}, 401));

      await expect(client.getCategories()).rejects.toThrow(
        /Authentication expired/,
      );
      expect(onUnauth).toHaveBeenCalledTimes(1);
    });
  });

  describe('relay mode', () => {
    beforeEach(() => {
      client.configure({mode: 'relay'});
    });

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
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          correlation_id: 'cid-4',
          action: 'dashboard.summary',
          status: 'timeout',
        }),
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

      await expect(client.getCategories()).rejects.toThrow(
        /Authentication expired/,
      );
      // getCategories is direct-only; switch back and try a relay call
      client.configure({mode: 'relay'});
      fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
      await expect(
        client.getDailySummary(),
      ).rejects.toThrow(/Authentication expired/);
      expect(onUnauth).toHaveBeenCalledTimes(2);
    });

    it('sends a server-side timeout that is below the client buffer', async () => {
      client.configure({mode: 'relay', timeoutMs: 10000});
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

  describe('createSale idempotency + retry', () => {
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

    it('attaches an Idempotency-Key header in direct mode', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({sale_id: 1, sale_number: 'S-1', total_cents: 100}),
      );
      await client.createSale(saleData);
      const headers = fetchMock.mock.calls[0][1]?.headers as Record<
        string,
        string
      >;
      expect(headers['Idempotency-Key']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('reuses the same key across retries on transient 5xx', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({message: 'down'}, 503))
        .mockResolvedValueOnce(
          jsonResponse({sale_id: 1, sale_number: 'S-1', total_cents: 100}),
        );

      await client.createSale(saleData);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const k1 = (fetchMock.mock.calls[0][1]?.headers as Record<string, string>)[
        'Idempotency-Key'
      ];
      const k2 = (fetchMock.mock.calls[1][1]?.headers as Record<string, string>)[
        'Idempotency-Key'
      ];
      expect(k1).toBeTruthy();
      expect(k2).toBe(k1);
    });

    it('does NOT retry on a 4xx (deterministic client error)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({message: 'invalid sale'}, 422),
      );
      await expect(client.createSale(saleData)).rejects.toThrow(
        /Request failed \(422\)/,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('retries on relay TIMEOUT envelope but not on a relay application error', async () => {
      client.configure({mode: 'relay'});

      // First call: relay timeout (retryable). Second: ok.
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

    it('gives up after maxAttempts and throws the last error', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({}, 503))
        .mockResolvedValueOnce(jsonResponse({}, 503))
        .mockResolvedValueOnce(jsonResponse({}, 503));

      await expect(client.createSale(saleData)).rejects.toThrow(
        /Request failed \(503\)/,
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('relay HTTP errors (no envelope)', () => {
    beforeEach(() => {
      client.configure({mode: 'relay'});
    });

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
      client.configure({mode: 'relay'});
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

  describe('workspace code & mode-switch token isolation', () => {
    it('sends X-Aeris-Workspace header in relay mode when workspaceCode is configured', async () => {
      client.configure({mode: 'relay', workspaceCode: 'acme-prod'});
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

    it('does NOT send workspace header in direct mode even if workspaceCode is set', async () => {
      client.configure({mode: 'direct', workspaceCode: 'acme-prod'});
      fetchMock.mockResolvedValueOnce(jsonResponse([{id: 1, name: 'Cat'}]));
      await client.getCategories();
      const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers).not.toHaveProperty('X-Aeris-Workspace');
    });

    it('relay auth.login sends X-Aeris-Workspace and NO Authorization header', async () => {
      client.configure({mode: 'relay', workspaceCode: 'acme-prod'});
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
      client.configure({mode: 'relay', workspaceCode: 'acme-prod'});
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
      // The fetched request must not have carried the stale token.
      const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers).not.toHaveProperty('Authorization');
    });

    it('authenticated relay call sends both X-Aeris-Workspace and Authorization', async () => {
      client.configure({mode: 'relay', workspaceCode: 'acme-prod'});
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

    it('configure() does NOT auto-wipe authToken on mode change (caller responsibility)', async () => {
      // configure() is fired reactively from App.tsx whenever connection
      // settings change — including on every cold-boot when settings hydrate
      // from storage. Auto-wiping the token on mode change would race with
      // restoreSession() and log the user out on every relay-mode launch.
      // Mode-change credential isolation lives at SettingsModal, where we
      // can distinguish a user-initiated toggle from a hydration sync.
      client.configure({mode: 'direct'});
      client.setAuthToken('user-token');
      const onUnauth = jest.fn();
      client.setOnUnauthorized(onUnauth);

      client.configure({mode: 'relay'});
      expect(onUnauth).not.toHaveBeenCalled();

      // The token survives the mode change and is sent on the next call
      // — SettingsModal must call clearLocalSession() before this point if
      // the change is user-initiated.
      client.configure({workspaceCode: 'acme-prod'});
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          correlation_id: 'cid-after-switch',
          action: 'dashboard.summary',
          status: 'ok',
          data: {date: '', sales_count: 0, revenue_cents: 0, items_sold: 0, average_sale_cents: 0, top_products: []},
        }),
      );
      await client.getDailySummary();
      const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer user-token');
    });

    it('configure() ignores an invalid workspaceCode (defense-in-depth)', async () => {
      // Quiet the expected console.warn so test output stays clean.
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      client.configure({mode: 'relay', workspaceCode: 'A!!bad'}); // fails regex
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
});
