// Thin renderer-side wrapper for the relay:call IPC. The renderer never
// talks to the network directly — strict CSP (connect-src 'none') would
// block any attempt. All traffic flows through the main process via
// window.aeris.relay.call().

import type { RelayCallOptions, RelayCallResult } from '../../shared-types/ipc';

export async function relayCall<T = unknown>(
  action: string,
  params?: unknown,
  options?: RelayCallOptions,
): Promise<RelayCallResult<T>> {
  return window.aeris.relay.call<T>(action, params, options);
}
