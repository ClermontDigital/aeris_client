import {RelayClient} from '../relay';

type FetchMock = jest.Mock<Promise<Response>, [RequestInfo, RequestInit?]>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  });
}

function envelope(data: unknown, status: 'ok' | 'error' = 'ok', extra: object = {}) {
  return jsonResponse({
    correlation_id: 'cid-dr',
    action: 'dr.routing',
    status,
    data,
    ...extra,
  });
}

if (!(globalThis as {crypto?: {randomUUID?: () => string}}).crypto?.randomUUID) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require('crypto');
  (globalThis as {crypto: {randomUUID: () => string}}).crypto = {
    randomUUID: () => nodeCrypto.randomUUID(),
  };
}

// M3-0 — RelayClient.getDrRouting() consume seam + the graceful-404 contract.
describe('RelayClient.getDrRouting — dr.routing seam (M3-0)', () => {
  let fetchMock: FetchMock;
  let client: RelayClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as unknown as {fetch: FetchMock}).fetch = fetchMock;
    client = new RelayClient();
    client.configure({relayUrl: 'https://api.aeris.team', timeoutMs: 5000});
    client.setAuthToken('user-bearer'); // user-traffic
  });

  it('returns the typed payload when DR is enabled', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope({
        dr_enabled: true,
        routing_target: 'local',
        partner_local_url: 'https://192.168.1.50:8822',
        partner_local_url_reported_at: '2026-06-30T00:00:00Z',
        active_writer: true,
        failback_eligible: false,
        sync_queue_depth: 3,
        served_at: '2026-06-30T00:00:01Z',
      }),
    );
    const r = await client.getDrRouting();
    expect(r).not.toBeNull();
    expect(r?.routing_target).toBe('local');
    expect(r?.partner_local_url).toBe('https://192.168.1.50:8822');
    expect(r?.failback_eligible).toBe(false);
    expect(r?.sync_queue_depth).toBe(3);

    // It posts the dr.routing action.
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init?.body as string).action).toBe('dr.routing');
  });

  it('GRACEFUL: a deployment-404 (no `dr` service config) → null, never throws', async () => {
    // Non-envelope 404 body → relayRpc throws Error with .status=404.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({message: 'service unavailable'}, 404),
    );
    await expect(client.getDrRouting()).resolves.toBeNull();
  });

  it('GRACEFUL: a NOT_FOUND error envelope (route unregistered) → null', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope(null, 'error', {error: {code: 'NOT_FOUND', message: 'no route'}}),
    );
    await expect(client.getDrRouting()).resolves.toBeNull();
  });

  it('GRACEFUL: dr_enabled=false → null (no DR surface, M2 manual path)', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope({
        dr_enabled: false,
        routing_target: 'cloud',
        partner_local_url: null,
        partner_local_url_reported_at: null,
        active_writer: false,
        failback_eligible: false,
        sync_queue_depth: 0,
        served_at: '2026-06-30T00:00:01Z',
      }),
    );
    await expect(client.getDrRouting()).resolves.toBeNull();
  });

  it('a NON-404 error (e.g. server 500-style error envelope) PROPAGATES — broken deploy not masked', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope(null, 'error', {error: {code: 'INTERNAL', message: 'boom'}}),
    );
    await expect(client.getDrRouting()).rejects.toMatchObject({
      name: 'RelayError',
      code: 'INTERNAL',
    });
  });
});
