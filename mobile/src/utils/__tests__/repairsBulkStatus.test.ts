import {reconcileBulkStatusResult} from '../repairsBulkStatus';

// T10 - Bulk-status reconciliation.
//
// Pure function; no React, no side effects. The four cases below map to the
// four documented outcomes of a bulk-status server call once
// RelayClient/DirectClient have already normalised the response into a
// canonical {succeeded, skipped} pair.
describe('reconcileBulkStatusResult', () => {
  it('reports full success when every requested id succeeded', () => {
    const out = reconcileBulkStatusResult(
      [1, 2, 3],
      {succeeded: [1, 2, 3], skipped: []},
    );
    expect(out.kind).toBe('success');
    expect(out.message).toBe('Updated 3 repairs.');
  });

  it('uses the singular noun for a single-repair full success', () => {
    // The future BulkStatusScreen may bulk-transition just one repair
    // (e.g. from a multi-select of size one). Grammar matters so the
    // toast doesn't read "Updated 1 repairs.".
    const out = reconcileBulkStatusResult(
      [42],
      {succeeded: [42], skipped: []},
    );
    expect(out.kind).toBe('success');
    expect(out.message).toBe('Updated 1 repair.');
  });

  it('reports partial success when some succeeded and some skipped', () => {
    const out = reconcileBulkStatusResult(
      [1, 2, 3, 4, 5],
      {succeeded: [1, 2, 3], skipped: [4, 5]},
    );
    expect(out.kind).toBe('partial');
    expect(out.message).toBe('3 of 5 repairs updated, 2 skipped.');
  });

  it('reports error when the server skipped everything', () => {
    // The "all skipped" case fires when every requested id was already in
    // the target status or non-transitionable. From the operator's POV
    // this is indistinguishable from an outright failure - nothing moved -
    // so we surface it as an error.
    const out = reconcileBulkStatusResult(
      [1, 2, 3],
      {succeeded: [], skipped: [1, 2, 3]},
    );
    expect(out.kind).toBe('error');
    expect(out.message).toBe('No repairs were updated.');
  });

  it('reports error when succeeded is empty even without a skipped list', () => {
    // Terminal fallback case from RelayClient: server acked but returned
    // nothing usable. Client-side already treats every requested id as
    // skipped, but defend the helper against a caller that hands in a
    // literal empty-skipped result too.
    const out = reconcileBulkStatusResult(
      [1, 2, 3],
      {succeeded: [], skipped: []},
    );
    expect(out.kind).toBe('error');
    expect(out.message).toBe('No repairs were updated.');
  });

  it('reports error for an empty requested set (edge case)', () => {
    // Guards a future caller that hands in an empty selection - the toast
    // should read as a no-op rather than a green "Updated 0 repairs."
    // which would misrepresent what happened.
    const out = reconcileBulkStatusResult([], {succeeded: [], skipped: []});
    expect(out.kind).toBe('error');
    expect(out.message).toBe('No repairs were selected.');
  });
});
