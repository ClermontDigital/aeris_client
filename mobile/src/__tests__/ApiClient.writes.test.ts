import {ApiClient} from '../services/ApiClient';

type FetchMock = jest.Mock<Promise<Response>, [RequestInfo, RequestInit?]>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

// Mirrors the fetch-mock pattern used in ApiClient.test.ts. Each test sets a
// fresh client so mode/auth state never leak across cases.
describe('ApiClient write surface (direct mode)', () => {
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
    client.setAuthToken('tok');
  });

  describe('createCustomer', () => {
    it('POSTs /api/v1/customers with bearer + Idempotency-Key headers', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({data: {id: 7, first_name: 'Ada', last_name: 'Lovelace'}}),
      );

      const result = await client.createCustomer({
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'ada@example.com',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://aeris.local:8000/api/v1/customers');
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer tok');
      expect(headers['Idempotency-Key']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      expect(body.first_name).toBe('Ada');
      expect(body.email).toBe('ada@example.com');
      expect(result.id).toBe(7);
      expect(result.first_name).toBe('Ada');
    });

    it('converts credit_limit_cents to dollar credit_limit on the wire', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({data: {id: 1, first_name: 'A'}}),
      );
      await client.createCustomer({
        first_name: 'A',
        credit_limit_cents: 50000,
      });
      const body = JSON.parse(
        fetchMock.mock.calls[0][1]?.body as string,
      ) as Record<string, unknown>;
      expect(body.credit_limit).toBe(500);
      expect(body).not.toHaveProperty('credit_limit_cents');
    });
  });

  describe('updateCustomer', () => {
    it('PUTs /api/v1/customers/42 with the patch payload', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({data: {id: 42, first_name: 'Ada', last_name: 'Byron'}}),
      );

      const result = await client.updateCustomer(42, {last_name: 'Byron'});

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://aeris.local:8000/api/v1/customers/42');
      expect(init?.method).toBe('PUT');
      // updateCustomer is a single-shot PUT — no Idempotency-Key, no retry.
      const headers = init?.headers as Record<string, string>;
      expect(headers).not.toHaveProperty('Idempotency-Key');
      expect(result.last_name).toBe('Byron');
    });
  });

  describe('deleteCustomer', () => {
    it('DELETEs /api/v1/customers/42 and resolves {ok: true} on 204', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, {status: 204}));

      const result = await client.deleteCustomer(42);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://aeris.local:8000/api/v1/customers/42');
      expect(init?.method).toBe('DELETE');
      expect(result).toEqual({ok: true});
    });
  });

  describe('createProduct', () => {
    it('POSTs /api/v1/products with bearer + Idempotency-Key + dollar pricing', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          data: {id: 11, name: 'Widget', sku: 'WGT-1', base_price: 19.99},
        }),
      );

      const result = await client.createProduct({
        name: 'Widget',
        sku: 'WGT-1',
        category_id: 3,
        base_price_cents: 1999,
        cost_price_cents: 800,
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://aeris.local:8000/api/v1/products');
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer tok');
      expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      expect(body.base_price).toBe(19.99);
      expect(body.cost_price).toBe(8);
      expect(body).not.toHaveProperty('base_price_cents');
      expect(body).not.toHaveProperty('cost_price_cents');
      expect(result.id).toBe(11);
    });
  });

  describe('updateProduct', () => {
    it('PUTs /api/v1/products/11 with the patch payload', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({data: {id: 11, name: 'Widget v2', sku: 'WGT-1'}}),
      );

      await client.updateProduct(11, {name: 'Widget v2'});

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://aeris.local:8000/api/v1/products/11');
      expect(init?.method).toBe('PUT');
    });
  });

  describe('adjustStock', () => {
    it('POSTs /api/v1/inventory/adjust-stock with idempotency + normalised result', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          data: {
            product_id: 5,
            previous_quantity: 10,
            new_quantity: 7,
            adjustment: -3,
            reason: 'damaged_goods',
          },
        }),
      );

      const result = await client.adjustStock({
        product_id: 5,
        adjustment: -3,
        reason: 'damaged_goods',
        notes: 'water damage',
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'http://aeris.local:8000/api/v1/inventory/adjust-stock',
      );
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      expect(body).toEqual({
        product_id: 5,
        adjustment: -3,
        reason: 'damaged_goods',
        notes: 'water damage',
      });
      expect(result.new_quantity).toBe(7);
      expect(result.adjustment).toBe(-3);
    });
  });

  describe('auth handling', () => {
    it('fires onUnauthorized on 401 for createCustomer', async () => {
      const onUnauth = jest.fn();
      client.setOnUnauthorized(onUnauth);
      fetchMock.mockResolvedValueOnce(jsonResponse({message: 'no'}, 401));

      await expect(
        client.createCustomer({first_name: 'A'}),
      ).rejects.toThrow(/Authentication expired/);
      expect(onUnauth).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ApiClient write surface (relay mode)', () => {
  let fetchMock: FetchMock;
  let client: ApiClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as unknown as {fetch: FetchMock}).fetch = fetchMock;
    client = new ApiClient();
    client.configure({
      baseUrl: 'http://aeris.local:8000',
      relayUrl: 'https://api.aeris.team',
      mode: 'relay',
      timeoutMs: 5000,
      workspaceCode: 'acme-prod',
    });
    client.setAuthToken('tok');
  });

  it('createCustomer dispatches to the relay with the customers.create action', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        correlation_id: 'cid-1',
        action: 'customers.create',
        status: 'ok',
        data: {id: 99, first_name: 'Grace', last_name: 'Hopper'},
      }),
    );

    const result = await client.createCustomer({
      first_name: 'Grace',
      last_name: 'Hopper',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.aeris.team/api/relay/rpc');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers['X-Aeris-Workspace']).toBe('acme-prod');
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body.action).toBe('customers.create');
    const params = body.params as Record<string, unknown>;
    expect(params.first_name).toBe('Grace');
    expect(result.id).toBe(99);
    expect(result.first_name).toBe('Grace');
  });
});
