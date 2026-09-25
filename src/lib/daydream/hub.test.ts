import { describe, expect, it } from 'vitest';

import { ROOMS, hubTabs, isLegacyLink, isRoom, legacyTabTarget } from './hub';

describe('hubTabs', () => {
  const base = { needsRating: 0, unrememberedRulings: 0, activeWatches: 0, needsNaming: 0, proposedRules: 0, failingJobs: 0, notesToRate: 0 };

  it('is the one feed plus the rooms that are not daydream, each a real route', () => {
    const tabs = hubTabs(base);
    expect(tabs.map((t) => t.id)).toEqual(['feed', 'watches', 'improvement', 'backlog']);
    expect(tabs[0].href).toBe('/jkai/daydreams');
    for (const t of tabs.slice(1)) expect(t.href).toBe(`/jkai/daydreams/${t.id}`);
    for (const t of tabs) expect(isRoom(t.id)).toBe(true);
  });

  it('badges count the populations the rooms act on', () => {
    const by = Object.fromEntries(hubTabs({ ...base, needsRating: 9, notesToRate: 3, activeWatches: 2 }).map((t) => [t.id, t]));
    expect(by.feed.count).toBe(3);
    expect(by.watches.count).toBe(2);
  });

  it('the old rooms are still rooms, so their URLs still resolve', () => {
    for (const r of ['memory', 'places', 'engine', 'family']) expect((ROOMS as readonly string[]).includes(r)).toBe(true);
  });
});

describe('isLegacyLink', () => {
  it('sends ?tab=, ?rate= and ?open= to the old rooms and keeps the bare path and ?note= here', () => {
    expect(isLegacyLink(new URL('https://x/jkai/daydreams?tab=places'))).toBe(true);
    expect(isLegacyLink(new URL('https://x/jkai/daydreams?rate=abc'))).toBe(true);
    expect(isLegacyLink(new URL('https://x/jkai/daydreams?open=abc'))).toBe(true);
    expect(isLegacyLink(new URL('https://x/jkai/daydreams'))).toBe(false);
    expect(isLegacyLink(new URL('https://x/jkai/daydreams?note=abc'))).toBe(false);
  });
});

describe('legacyTabTarget', () => {
  it('maps ?tab= to the room and keeps the rest of the query; the browser keeps the hash', () => {
    expect(legacyTabTarget(new URL('https://x/jkai/daydreams?tab=places#place-p1'))).toBe('/jkai/daydreams/places');
    expect(legacyTabTarget(new URL('https://x/jkai/daydreams?tab=feed&rate=abc'))).toBe('/jkai/daydreams/feed?rate=abc');
  });
  it('lands unknown or missing tabs on the feed', () => {
    expect(legacyTabTarget(new URL('https://x/jkai/daydreams'))).toBe('/jkai/daydreams/feed');
    expect(legacyTabTarget(new URL('https://x/jkai/daydreams?tab=nope&rate=1'))).toBe('/jkai/daydreams/feed?rate=1');
    expect(isRoom('engine')).toBe(true);
    expect(isRoom('nope')).toBe(false);
  });
});
