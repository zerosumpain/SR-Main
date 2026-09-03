import { describe, expect, it } from 'vitest';

import { ROOMS, hubTabs, isRoom, legacyTabTarget } from './hub';

describe('hubTabs', () => {
  const base = { needsRating: 0, unrememberedRulings: 0, activeWatches: 0, needsNaming: 0, proposedRules: 0, failingJobs: 0 };

  it('is one real route per room, in rail order', () => {
    const tabs = hubTabs(base);
    expect(tabs.map((t) => t.id)).toEqual([...ROOMS]);
    for (const t of tabs) expect(t.href).toBe(`/jkai/daydreams/${t.id}`);
  });

  it('badges count the populations the rooms act on', () => {
    const tabs = hubTabs({ ...base, needsRating: 3, unrememberedRulings: 2, needsNaming: 4, proposedRules: 1 });
    const by = Object.fromEntries(tabs.map((t) => [t.id, t]));
    expect(by.feed.count).toBe(3);
    expect(by.memory.count).toBe(2);
    expect(by.places.count).toBe(4);
    expect(by.engine.count).toBe(1);
    expect(by.engine.tone).toBe('action');
  });

  it('a failing job takes the engine badge over a proposed rule, and warns', () => {
    const by = Object.fromEntries(hubTabs({ ...base, proposedRules: 0, failingJobs: 2 }).map((t) => [t.id, t]));
    expect(by.engine.count).toBe(2);
    expect(by.engine.tone).toBe('watch');
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
