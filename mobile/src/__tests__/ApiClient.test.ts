import {ApiClient, RelayError} from '../services/ApiClient';

type FetchMock = jest.Mock<Promise<Response>, [RequestInfo, RequestInit?]>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

describe('ApiClient (mobile facade)', () => {
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
      // Idempotent reads now retry once on transient 5xx. Use
      // mockImplementation so each retry gets a fresh Response — Response
      // bodies can only be read once.
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse({message: 'oops'}, 500)),
      );
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

  describe('createSale idempotency + retry (direct)', () => {
    const saleData = {
      items: [{product_id: 1, quantity: 1, unit_price_cents: 100}],
      payments: [{method: 'cash', amount_cents: 100}],
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

  describe('mode dispatch', () => {
    it('relay-mode call hits the relay endpoint, not direct baseUrl', async () => {
      client.configure({mode: 'relay'});
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          correlation_id: 'cid',
          action: 'dashboard.summary',
          status: 'ok',
          data: {date: '', sales_count: 0, revenue_cents: 0, items_sold: 0, average_sale_cents: 0, top_products: []},
        }),
      );
      await client.getDailySummary();
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.aeris.team/api/relay/rpc');
    });

    it('direct-mode call hits the direct baseUrl, not the relay', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({categories: []}));
      await client.getCategories();
      const [url] = fetchMock.mock.calls[0];
      expect(String(url).startsWith('http://aeris.local:8000')).toBe(true);
    });

    it('configure() does NOT auto-wipe authToken on mode change (caller responsibility)', async () => {
      // configure() is fired reactively from App.tsx whenever connection
      // settings change — including on every cold-boot when settings hydrate
      // from storage. Auto-wiping the token on mode change would race with
      // restoreSession() and log the user out on every relay-mode launch.
      client.configure({mode: 'direct'});
      client.setAuthToken('user-token');
      const onUnauth = jest.fn();
      client.setOnUnauthorized(onUnauth);

      client.configure({mode: 'relay'});
      expect(onUnauth).not.toHaveBeenCalled();

      // The token survives the mode change and is sent on the next call —
      // SettingsModal must call clearLocalSession() before this point if the
      // change is user-initiated.
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

    it('does NOT send workspace header in direct mode even if workspaceCode is set', async () => {
      client.configure({mode: 'direct', workspaceCode: 'acme-prod'});
      fetchMock.mockResolvedValueOnce(jsonResponse([{id: 1, name: 'Cat'}]));
      await client.getCategories();
      const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers).not.toHaveProperty('X-Aeris-Workspace');
    });

    it('RelayError is re-exported from the facade for back-compat', () => {
      const e = new RelayError('test', 'TIMEOUT', 'cid', 'foo.bar');
      expect(e).toBeInstanceOf(Error);
      expect(e.code).toBe('TIMEOUT');
    });
  });
});
