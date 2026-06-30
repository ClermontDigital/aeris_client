// DR M3 — per-endpoint partition selection (pure, no electron).
//
// Proves: the right persistent partition is picked per mode + cashier, cloud and
// NAS are isolated namespaces, and the explicit-logout helpers scope to ONE
// endpoint (so logging out of cloud cannot wipe NAS, and vice-versa).

const {
  partitionFor,
  partitionsForEndpoint,
  allPartitions,
} = require('../dr-partition');

describe('partitionFor', () => {
  // CLOUD reuses the LEGACY names (persist:main / persist:user-<id>) so an
  // existing install's warm cloud session survives the update with no re-login.
  test('cloud mode, no cashier → persist:main (legacy, preserved)', () => {
    expect(partitionFor('cloud', null)).toBe('persist:main');
    expect(partitionFor('cloud', undefined)).toBe('persist:main');
    expect(partitionFor('cloud', '')).toBe('persist:main');
  });

  test('local (in-store) mode, no cashier → persist:nas', () => {
    expect(partitionFor('local', null)).toBe('persist:nas');
  });

  test('cloud mode, per-cashier → persist:user-<id> (legacy, preserved)', () => {
    expect(partitionFor('cloud', 'abc')).toBe('persist:user-abc');
  });

  test('local mode, per-cashier → persist:nas:user-<id>', () => {
    expect(partitionFor('local', 'abc')).toBe('persist:nas:user-abc');
  });

  test('unknown mode falls back to the cloud endpoint (legacy persist:main)', () => {
    expect(partitionFor('something-else', null)).toBe('persist:main');
  });

  test('ISOLATION: the same cashier gets DIFFERENT partitions per endpoint', () => {
    const cloud = partitionFor('cloud', 'cashier-1');
    const nas = partitionFor('local', 'cashier-1');
    expect(cloud).not.toBe(nas);
    // The NAS partition is a distinct namespace; the cloud one never carries it.
    expect(nas.startsWith('persist:nas')).toBe(true);
    expect(cloud.includes('nas')).toBe(false);
  });
});

describe('partitionsForEndpoint', () => {
  test('with no cashiers, returns just the base endpoint partition', () => {
    expect(partitionsForEndpoint('cloud')).toEqual(['persist:main']);
    expect(partitionsForEndpoint('local', [])).toEqual(['persist:nas']);
  });

  test('includes every per-cashier partition for that ONE endpoint', () => {
    expect(partitionsForEndpoint('local', ['a', 'b'])).toEqual([
      'persist:nas',
      'persist:nas:user-a',
      'persist:nas:user-b',
    ]);
  });

  test('a cloud logout list NEVER contains a NAS partition (isolation)', () => {
    const cloudParts = partitionsForEndpoint('cloud', ['a', 'b']);
    expect(cloudParts.some((p) => p.includes('nas'))).toBe(false);
  });
});

describe('allPartitions (full / handover logout)', () => {
  test('covers BOTH endpoints for every cashier', () => {
    const all = allPartitions(['a']);
    expect(all).toEqual([
      'persist:main',
      'persist:user-a',
      'persist:nas',
      'persist:nas:user-a',
    ]);
  });
});
