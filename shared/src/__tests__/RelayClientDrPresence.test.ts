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
    correlation_id: 'cid-pres',
    action: 'dr.presence',
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

// M3 — RelayClient.reportDrPresence(): best-effort, fire-and-forget. Treats
// ANY non-2xx (incl. 405/404 on flag-off deployments + NOT_FOUND envelopes) and
// any transport error as a silent no-op (returns false, never throws).
describe('RelayClient.reportDrPresence — DR presence beat (M3)', () => {
  let fetchMock: FetchMock;
  let client: RelayClient;
  const beat = {device_id: 'dev-1', mode: 'local' as const};

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as unknown as {fetch: FetchMock}).fetch = fetchMock;
    client = new RelayClient();
    client.configure({relayUrl: 'https://api.aeris.team', timeoutMs: 5000});
    client.setAuthToken('user-bearer');
  });

  it('returns true on a clean relay round-trip and posts dr.presence {device_id, mode}', async () => {
    fetchMock.mockResolvedValueOnce(envelope({recorded: true}));
    await expect(client.reportDrPresence(beat)).resolves.toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body.action).toBe('dr.presence');
    expect(body.params).toEqual({device_id: 'dev-1', mode: 'local'});
  });

  it('best-effort: a deployment-404 (flag-off, no `dr` service) → false, never throws', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({message: 'no service'}, 404));
    await expect(client.reportDrPresence(beat)).resolves.toBe(false);
  });

  it('best-effort: a 405 (presence proxy not shipped) → false, never throws', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({message: 'method'}, 405));
    await expect(client.reportDrPresence(beat)).resolves.toBe(false);
  });

  it('best-effort: a NOT_FOUND error envelope → false, never throws', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope(null, 'error', {error: {code: 'NOT_FOUND', message: 'no route'}}),
    );
    await expect(client.reportDrPresence(beat)).resolves.toBe(false);
  });

  it('best-effort: a transport throw (network down) → false, never throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network request failed'));
    await expect(client.reportDrPresence(beat)).resolves.toBe(false);
  });
});
