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
  test('cloud mode, no cashier → persist:cloud', () => {
    expect(partitionFor('cloud', null)).toBe('persist:cloud');
    expect(partitionFor('cloud', undefined)).toBe('persist:cloud');
    expect(partitionFor('cloud', '')).toBe('persist:cloud');
  });

  test('local (in-store) mode, no cashier → persist:nas', () => {
    expect(partitionFor('local', null)).toBe('persist:nas');
  });

  test('cloud mode, per-cashier → persist:cloud:user-<id>', () => {
    expect(partitionFor('cloud', 'abc')).toBe('persist:cloud:user-abc');
  });

  test('local mode, per-cashier → persist:nas:user-<id>', () => {
    expect(partitionFor('local', 'abc')).toBe('persist:nas:user-abc');
  });

  test('unknown mode falls back to the cloud endpoint (safe default)', () => {
    expect(partitionFor('something-else', null)).toBe('persist:cloud');
  });

  test('ISOLATION: the same cashier gets DIFFERENT partitions per endpoint', () => {
    const cloud = partitionFor('cloud', 'cashier-1');
    const nas = partitionFor('local', 'cashier-1');
    expect(cloud).not.toBe(nas);
    // Neither name is a prefix collision of the other endpoint's.
    expect(cloud.startsWith('persist:cloud')).toBe(true);
    expect(nas.startsWith('persist:nas')).toBe(true);
  });
});

describe('partitionsForEndpoint', () => {
  test('with no cashiers, returns just the base endpoint partition', () => {
    expect(partitionsForEndpoint('cloud')).toEqual(['persist:cloud']);
    expect(partitionsForEndpoint('local', [])).toEqual(['persist:nas']);
  });

  test('includes every per-cashier partition for that ONE endpoint', () => {
    expect(partitionsForEndpoint('nas' === 'nas' ? 'local' : 'local', ['a', 'b'])).toEqual([
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
      'persist:cloud',
      'persist:cloud:user-a',
      'persist:nas',
      'persist:nas:user-a',
    ]);
  });
});
