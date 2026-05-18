import {DirectClient} from '../DirectClient';

type FetchMock = jest.Mock<Promise<Response>, [RequestInfo, RequestInit?]>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

describe('DirectClient.createSale tax_rate -> gst_applicable', () => {
  let fetchMock: FetchMock;
  let client: DirectClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as unknown as {fetch: FetchMock}).fetch = fetchMock;
    client = new DirectClient();
    client.configure({baseUrl: 'http://aeris.local:8000'});
    client.setAuthToken('tok');
  });

  function lastBody(): Record<string, unknown> {
    const init = fetchMock.mock.calls[0][1];
    return JSON.parse(init?.body as string) as Record<string, unknown>;
  }

  function makeData(taxRate: number | undefined) {
    return {
      items: [
        {
          product_id: 1,
          quantity: 1,
          unit_price_cents: 1000,
          ...(taxRate === undefined ? {} : {tax_rate: taxRate}),
        },
      ],
      payments: [{method: 'cash', amount_cents: 1000}],
    };
  }

  test('tax_rate: 10 → gst_applicable: true', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({sale_id: 1, sale_number: 'S-1', total_cents: 1000}),
    );
    await client.createSale(makeData(10));
    const body = lastBody();
    const items = body.items as Array<{gst_applicable: boolean}>;
    expect(items[0].gst_applicable).toBe(true);
  });

  test('tax_rate: 0 → gst_applicable: false', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({sale_id: 1, sale_number: 'S-1', total_cents: 1000}),
    );
    await client.createSale(makeData(0));
    const body = lastBody();
    const items = body.items as Array<{gst_applicable: boolean}>;
    expect(items[0].gst_applicable).toBe(false);
  });

  test('tax_rate: undefined → gst_applicable: true (10% default)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({sale_id: 1, sale_number: 'S-1', total_cents: 1000}),
    );
    await client.createSale(makeData(undefined));
    const body = lastBody();
    const items = body.items as Array<{gst_applicable: boolean}>;
    expect(items[0].gst_applicable).toBe(true);
  });
});
