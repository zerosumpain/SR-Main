import { describe, it, expect } from 'vitest';
import { resolveVisibilityMap, isProjectPublic, filterForViewer } from './visibility';

describe('resolveVisibilityMap', () => {
  it('builds a key -> isPublic map from rows', () => {
    const map = resolveVisibilityMap([
      { projectKey: 'whitehall', isPublic: false },
      { projectKey: 'policy-engine', isPublic: true },
    ]);
    expect(map).toEqual({ whitehall: false, 'policy-engine': true });
  });

  it('returns an empty map for no rows', () => {
    expect(resolveVisibilityMap([])).toEqual({});
  });
});

describe('isProjectPublic', () => {
  it('defaults to public when there is no row for the key', () => {
    expect(isProjectPublic({}, 'brass-and-rails')).toBe(true);
  });

  it('honours an explicit private row', () => {
    expect(isProjectPublic({ 'brass-and-rails': false }, 'brass-and-rails')).toBe(false);
  });

  it('honours an explicit public row', () => {
    expect(isProjectPublic({ whitehall: true }, 'whitehall')).toBe(true);
  });
});

describe('filterForViewer', () => {
  const items = [
    { key: 'a' },
    { key: 'b' },
    { key: 'c' },
  ];
  const map = { b: false }; // b is private, a and c default public

  it('returns every item for an authed viewer', () => {
    expect(filterForViewer(items, map, true)).toEqual(items);
  });

  it('hides private items from a public viewer', () => {
    expect(filterForViewer(items, map, false)).toEqual([{ key: 'a' }, { key: 'c' }]);
  });

  it('keeps default-public items for a public viewer', () => {
    expect(filterForViewer([{ key: 'x' }], {}, false)).toEqual([{ key: 'x' }]);
  });
});
