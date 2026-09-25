import { describe, expect, it } from 'vitest';

import { RETIRED_ROOMS, ROOMS, hubTabs, isLegacyLink, isRoom, legacyTabTarget } from './hub';

describe('hubTabs', () => {
  const base = { activeWatches: 0, notesToRate: 0 };

  it('is the one feed plus the rooms that are not daydream, each a real route', () => {
    const tabs = hubTabs(base);
    expect(tabs.map((t) => t.id)).toEqual(['feed', 'watches', 'improvement', 'backlog']);
    expect(tabs[0].href).toBe('/jkai/daydreams');
    for (const t of tabs.slice(1)) expect(t.href).toBe(`/jkai/daydreams/${t.id}`);
    for (const t of tabs) expect(isRoom(t.id)).toBe(true);
  });

  it('badges count the populations the rooms act on', () => {
    const by = Object.fromEntries(hubTabs({ notesToRate: 3, activeWatches: 2 }).map((t) => [t.id, t]));
    expect(by.feed.count).toBe(3);
    expect(by.watches.count).toBe(2);
  });

  it('the retired rooms are no longer rooms', () => {
    for (const r of RETIRED_ROOMS) if (r !== 'feed') expect((ROOMS as readonly string[]).includes(r)).toBe(false);
  });
});

describe('isLegacyLink', () => {
  it('flags ?tab=, ?rate= and ?open= and keeps the bare path and ?note= here', () => {
    expect(isLegacyLink(new URL('https://x/jkai/daydreams?tab=places'))).toBe(true);
    expect(isLegacyLink(new URL('https://x/jkai/daydreams?rate=abc'))).toBe(true);
    expect(isLegacyLink(new URL('https://x/jkai/daydreams?open=abc'))).toBe(true);
    expect(isLegacyLink(new URL('https://x/jkai/daydreams'))).toBe(false);
    expect(isLegacyLink(new URL('https://x/jkai/daydreams?note=abc'))).toBe(false);
  });
});

describe('legacyTabTarget', () => {
  it('sends a ?tab= naming a living room to that room', () => {
    expect(legacyTabTarget(new URL('https://x/jkai/daydreams?tab=memory'))).toBe('/jkai/daydreams/memory');
  });
  it('lands retired, unknown or missing tabs on the feed, carrying a thought id as ?note=', () => {
    expect(legacyTabTarget(new URL('https://x/jkai/daydreams?tab=places#place-p1'))).toBe('/jkai/daydreams');
    expect(legacyTabTarget(new URL('https://x/jkai/daydreams?tab=feed&rate=abc'))).toBe('/jkai/daydreams?note=abc');
    expect(legacyTabTarget(new URL('https://x/jkai/daydreams?open=t1'))).toBe('/jkai/daydreams?note=t1');
    expect(legacyTabTarget(new URL('https://x/jkai/daydreams?tab=nope'))).toBe('/jkai/daydreams');
  });
  it('never produces another legacy link, so the redirect cannot loop', () => {
    for (const q of ['tab=feed&rate=1', 'tab=engine', 'open=x', 'tab=nope&rate=1']) {
      expect(isLegacyLink(new URL(`https://x${legacyTabTarget(new URL(`https://x/jkai/daydreams?${q}`))}`))).toBe(false);
    }
  });
  it('knows the living rooms and not the retired ones', () => {
    expect(isRoom('backlog')).toBe(true);
    expect(isRoom('engine')).toBe(false);
    expect(isRoom('nope')).toBe(false);
  });
});
