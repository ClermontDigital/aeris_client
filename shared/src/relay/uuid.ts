// Resolve crypto.randomUUID at call time so test environments (older Node
// versions, Hermes builds without the global) get a clear error rather than a
// silent undefined cast. Node 18+, modern browsers, and Hermes on Expo SDK
// 55+ all expose globalThis.crypto.randomUUID.
type CryptoLike = {randomUUID?: () => string};

export function generateUuid(): string {
  const c = (globalThis as {crypto?: CryptoLike}).crypto;
  if (!c || typeof c.randomUUID !== 'function') {
    throw new Error(
      '@aeris/shared: globalThis.crypto.randomUUID is not available. ' +
        'Mobile callers must polyfill via expo-crypto before invoking the relay client.',
    );
  }
  return c.randomUUID();
}
