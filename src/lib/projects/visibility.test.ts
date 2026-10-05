import { describe, it, expect } from 'vitest';
import {
  resolveVisibilityMap,
  isProjectPublic,
  isProjectSlug,
  isStaticProjectKey,
  defaultsPublic,
  filterForViewer,
} from './visibility';

describe('resolveVisibilityMap', () => {
  it('builds a key -> isPublic map from rows', () => {
    const map = resolveVisibilityMap([
      { projectKey: 'engine-room', isPublic: false },
      { projectKey: 'policy-engine', isPublic: true },
    ]);
    expect(map).toEqual({ 'engine-room': false, 'policy-engine': true });
  });

  it('returns an empty map for no rows', () => {
    expect(resolveVisibilityMap([])).toEqual({});
  });
});

describe('isProjectSlug', () => {
  it('accepts a /projects address', () => {
    expect(isProjectSlug('terminal-descent')).toBe(true);
    expect(isProjectSlug('stopwatch')).toBe(true);
    expect(isProjectSlug('0ad-strategy')).toBe(true);
  });

  it('rejects a PR URL parked in publishedSlug by a git-target build', () => {
    expect(isProjectSlug('https://github.com/zerosumpain/SR-Main/pull/341')).toBe(false);
  });

  it('rejects a branch ref parked in publishedSlug', () => {
    expect(isProjectSlug('master...agent/ab2-a15e73d3')).toBe(false);
  });

  it('rejects nothing-at-all and anything with path or case in it', () => {
    expect(isProjectSlug(null)).toBe(false);
    expect(isProjectSlug(undefined)).toBe(false);
    expect(isProjectSlug('')).toBe(false);
    expect(isProjectSlug('a/b')).toBe(false);
    expect(isProjectSlug('-leading-dash')).toBe(false);
    expect(isProjectSlug('Whitehall')).toBe(false);
  });
});

describe('defaultsPublic', () => {
  it('makes a hand-built project page public with no row', () => {
    expect(isStaticProjectKey('policy-engine')).toBe(true);
    expect(defaultsPublic('policy-engine')).toBe(true);
  });

  it('keeps the URL-only pulse bundle public with no row', () => {
    expect(defaultsPublic('pulse')).toBe(true);
  });

  it('makes the Marbler game public with no row', () => {
    expect(isStaticProjectKey('marbler')).toBe(true);
    expect(defaultsPublic('marbler')).toBe(true);
  });

  it('makes an AI build private with no row', () => {
    expect(isStaticProjectKey('compound-interest-calculator')).toBe(false);
    expect(defaultsPublic('compound-interest-calculator')).toBe(false);
  });
});

describe('isProjectPublic', () => {
  it('defaults a static card to public when there is no row for the key', () => {
    expect(isProjectPublic({}, 'engine-room')).toBe(true);
  });

  it('defaults a build slug to PRIVATE when there is no row for the key', () => {
    // The Forge publishing a self-improvement build must not put it on
    // /projects; only an explicit toggle does that.
    expect(isProjectPublic({}, 'sr-stack-architecture')).toBe(false);
  });

  it('honours an explicit private row', () => {
    expect(isProjectPublic({ 'engine-room': false }, 'engine-room')).toBe(false);
  });

  it('honours an explicit public row', () => {
    expect(isProjectPublic({ 'engine-room': true }, 'engine-room')).toBe(true);
    expect(isProjectPublic({ stopwatch: true }, 'stopwatch')).toBe(true);
  });
});

describe('filterForViewer', () => {
  // Static keys, so the pre-existing "no row means public" rule applies.
  const items = [
    { key: 'policy-engine' },
    { key: 'engine-room' },
    { key: 'archetype' },
  ];
  const map = { 'engine-room': false };

  it('returns every item for an authed viewer', () => {
    expect(filterForViewer(items, map, true)).toEqual(items);
  });

  it('hides private items from a public viewer', () => {
    expect(filterForViewer(items, map, false)).toEqual([
      { key: 'policy-engine' },
      { key: 'archetype' },
    ]);
  });

  it('keeps default-public items for a public viewer', () => {
    expect(filterForViewer([{ key: 'engine-room' }], {}, false)).toEqual([{ key: 'engine-room' }]);
  });

  it('hides an untoggled build from a public viewer', () => {
    expect(filterForViewer([{ key: 'graphing-calculator' }], {}, false)).toEqual([]);
  });
});

describe('private-by-default static key (field-study-8)', () => {
  it('is a static key, so it gets a card, a toggle and share links', () => {
    expect(isStaticProjectKey('field-study-8')).toBe(true);
  });

  it('defaults private with no project_visibility row', () => {
    expect(defaultsPublic('field-study-8')).toBe(false);
    expect(isProjectPublic({}, 'field-study-8')).toBe(false);
  });

  it('is hidden from the public listing and shown to the owner', () => {
    const items = [{ key: 'field-study-8' }];
    expect(filterForViewer(items, {}, false)).toEqual([]);
    expect(filterForViewer(items, {}, true)).toEqual(items);
  });

  it('becomes public only through an explicit row', () => {
    expect(isProjectPublic({ 'field-study-8': true }, 'field-study-8')).toBe(true);
  });
});

describe('private-by-default static key (data-spine)', () => {
  // The Data Spine is served by its own app (SR-DataSpine) and gets its card and
  // toggle here. Registering a static key would otherwise publish it on deploy.
  it('is a static key that defaults private with no project_visibility row', () => {
    expect(isStaticProjectKey('data-spine')).toBe(true);
    expect(defaultsPublic('data-spine')).toBe(false);
    expect(isProjectPublic({}, 'data-spine')).toBe(false);
  });

  it('is hidden from the public listing and shown to the owner', () => {
    const items = [{ key: 'data-spine' }];
    expect(filterForViewer(items, {}, false)).toEqual([]);
    expect(filterForViewer(items, {}, true)).toEqual(items);
  });

  it('becomes public only through an explicit row', () => {
    expect(isProjectPublic({ 'data-spine': true }, 'data-spine')).toBe(true);
  });
});

describe('private-by-default static key (supply-chain-monitor)', () => {
  // Supply Chain Monitor is served by its own app (zerosumpain/supply-chain-monitor),
  // owner-only; the card must not publish itself on deploy.
  it('is a static key that defaults private with no project_visibility row', () => {
    expect(isStaticProjectKey('supply-chain-monitor')).toBe(true);
    expect(defaultsPublic('supply-chain-monitor')).toBe(false);
    expect(isProjectPublic({}, 'supply-chain-monitor')).toBe(false);
  });

  it('is hidden from the public listing and shown to the owner', () => {
    const items = [{ key: 'supply-chain-monitor' }];
    expect(filterForViewer(items, {}, false)).toEqual([]);
    expect(filterForViewer(items, {}, true)).toEqual(items);
  });
});
