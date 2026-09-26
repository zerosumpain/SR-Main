import { describe, expect, it } from 'vitest';

import { hubTabs, isLegacyLink, isRoom, legacyTabTarget } from './hub';

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
    const by = Object.fromEntries(hubTabs({ ...base, notesToRate: 3, activeWatches: 2 }).map((t) => [t.id, t]));
    expect(by.feed.count).toBe(3);
    expect(by.watches.count).toBe(2);
  });

  it('the retired rooms are not rooms any more (their URLs are 308 stubs)', () => {
    for (const r of ['memory', 'places', 'engine', 'family', 'discoveries', 'money', 'calendar']) expect(isRoom(r)).toBe(false);
  });
});

describe('isLegacyLink', () => {
  it('treats ?tab=, ?rate= and ?open= as legacy links and keeps the bare path and ?note= here', () => {
    expect(isLegacyLink(new URL('https://x/jkai/daydreams?tab=places'))).toBe(true);
    expect(isLegacyLink(new URL('https://x/jkai/daydreams?rate=abc'))).toBe(true);
    expect(isLegacyLink(new URL('https://x/jkai/daydreams?open=abc'))).toBe(true);
    expect(isLegacyLink(new URL('https://x/jkai/daydreams'))).toBe(false);
    expect(isLegacyLink(new URL('https://x/jkai/daydreams?note=abc'))).toBe(false);
  });
});

describe('legacyTabTarget', () => {
  it('maps ?tab= to a room still housed here and keeps the rest of the query', () => {
    expect(legacyTabTarget(new URL('https://x/jkai/daydreams?tab=watches'))).toBe('/jkai/daydreams/watches');
    expect(legacyTabTarget(new URL('https://x/jkai/daydreams?tab=backlog&x=1'))).toBe('/jkai/daydreams/backlog?x=1');
  });
  it('lands retired, unknown or missing tabs and old ?rate=/?open= links on the bare feed, never on a legacy link', () => {
    expect(legacyTabTarget(new URL('https://x/jkai/daydreams?tab=places#place-p1'))).toBe('/jkai/daydreams');
    expect(legacyTabTarget(new URL('https://x/jkai/daydreams?tab=feed&rate=abc'))).toBe('/jkai/daydreams');
    expect(legacyTabTarget(new URL('https://x/jkai/daydreams?open=abc&note=n1'))).toBe('/jkai/daydreams?note=n1');
    expect(legacyTabTarget(new URL('https://x/jkai/daydreams?tab=nope&rate=1'))).toBe('/jkai/daydreams');
    for (const u of ['?tab=places', '?rate=1', '?open=1&tab=watches']) {
      expect(isLegacyLink(new URL(legacyTabTarget(new URL(`https://x/jkai/daydreams${u}`)), 'https://x'))).toBe(false);
    }
    expect(isRoom('engine')).toBe(false);
    expect(isRoom('watches')).toBe(true);
    expect(isRoom('nope')).toBe(false);
  });
});
