import {resolveUserLocationId} from '../types/api.types';

describe('resolveUserLocationId', () => {
  it('returns null for null/undefined user', () => {
    expect(resolveUserLocationId(null)).toBeNull();
    expect(resolveUserLocationId(undefined)).toBeNull();
  });

  it('reads the flat location_id when present', () => {
    expect(resolveUserLocationId({location_id: 7})).toBe(7);
  });

  it('reads the nested location.id (the Aeris2 UserResource shape)', () => {
    // The server sends `location: {id, name, code}` nested, not a flat
    // location_id — this is the shape that was silently failing repair
    // create with "your account has no location assigned".
    expect(
      resolveUserLocationId({location: {id: 42, name: 'Main', code: 'MN'}}),
    ).toBe(42);
  });

  it('prefers the flat location_id over the nested shape when both present', () => {
    expect(
      resolveUserLocationId({location_id: 7, location: {id: 42}}),
    ).toBe(7);
  });

  it('returns null when neither shape carries a location', () => {
    expect(resolveUserLocationId({})).toBeNull();
    expect(resolveUserLocationId({location_id: null})).toBeNull();
    expect(resolveUserLocationId({location: null})).toBeNull();
    expect(resolveUserLocationId({location: {} as {id?: number}})).toBeNull();
  });

  it('ignores a non-numeric flat location_id and falls through to nested', () => {
    expect(
      resolveUserLocationId({
        location_id: undefined,
        location: {id: 5},
      }),
    ).toBe(5);
  });
});
