import {ApiClient} from '../services/ApiClient';

type FetchMock = jest.Mock<Promise<Response>, [RequestInfo, RequestInit?]>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

// Minimal relay envelope helper — matches the gateway's RPCResponse shape.
function relayEnvelope(data: unknown, action = 'sale.create') {
  return {
    correlation_id: 'cid-test',
    action,
    status: 'ok' as const,
    data,
  };
}

// Pull the JSON body that ApiClient sent on its last fetch call.
function readSentBody(fetchMock: FetchMock): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1];
  const body = init?.body as string | undefined;
  if (!body) throw new Error('no body sent');
  const parsed = JSON.parse(body);
  // In relay mode the actual sale payload sits under `params`.
  // In direct mode the body IS the payload.
  return (parsed.params ?? parsed) as Record<string, unknown>;
}

describe('createSale payload conversion', () => {
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
      workspaceCode: 'aeris-demo',
      timeoutMs: 5000,
    });
    client.setAuthToken('user-bearer');
  });

  it('converts cents → dollars and includes subtotal/tax_amount/total_amount', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        relayEnvelope({id: 42, sale_number: 'S-42', total_cents: 1100}),
      ),
    );

    await client.createSale({
      items: [{product_id: 1, quantity: 2, unit_price_cents: 550}],
      payments: [{method: 'cash', amount_cents: 1100}],
    });

    const sent = readSentBody(fetchMock);
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

    const sent = readSentBody(fetchMock);
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

    const sent = readSentBody(fetchMock);
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

    const payments = (readSentBody(fetchMock).payments as Array<
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

    const items = readSentBody(fetchMock).items as Array<
      Record<string, unknown>
    >;
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
