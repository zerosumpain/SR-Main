// The golden fixtures (scripts/hometowns/fixture.ts): hand-built, so they are
// stable whatever the packages do; valid, so every package can step them.

import { describe, expect, it } from 'vitest';
import { FIXTURE_KINDS, fixture, fixturePopulation } from '../../../../../scripts/hometowns/fixture';
import { catchUp } from './county';
import { checkCounty } from './invariants';
import { stateHash } from './index';
import { publicCard } from './snapshot';
import { countyMonth } from './clock';

describe('golden fixtures', () => {
  it.each(FIXTURE_KINDS)('%s is valid, JSON-safe and a fresh copy each call', (kind) => {
    const f = fixture(kind);
    expect(checkCounty(f.county)).toEqual([]);
    expect(JSON.parse(JSON.stringify(f))).toEqual(f);
    const g = fixture(kind);
    g.county.towns[g.town].money.reserves += 1;
    expect(fixture(kind).county.towns[f.town].money.reserves).toBe(f.county.towns[f.town].money.reserves);
    expect(stateHash(fixture(kind).county.towns[f.town])).toBe(stateHash(f.county.towns[f.town]));
  });

  it('sizes match their tiers', () => {
    const [h, t, m] = FIXTURE_KINDS.map((k) => fixture(k));
    expect(fixturePopulation(h)).toBeGreaterThan(100);
    expect(fixturePopulation(h)).toBeLessThan(300);
    expect(fixturePopulation(t)).toBeGreaterThan(2000);
    expect(fixturePopulation(t)).toBeLessThan(15000);
    expect(fixturePopulation(m)).toBeGreaterThan(80000);
    expect(h.county.towns[h.town].tier).toBe(0);
    expect(t.county.towns[t.town].tier).toBe(2);
    expect(m.county.towns[m.town].tier).toBe(4);
    expect(m.county.towns[m.town].buildings.length).toBeGreaterThan(30);
    expect(publicCard(m.county.towns[m.town]).faces.reduce((a, b) => a + b, 0)).toBe(fixturePopulation(m));
  });

  it.each(FIXTURE_KINDS)('%s stands on the county clock and keeps stepping cleanly', (kind) => {
    const f = fixture(kind);
    const t = f.county.towns[f.town];
    expect(t.gridBase).not.toBeNull();
    expect(t.tick % 4).toBe(0);
    expect(f.county.snapshot.month).toBe(countyMonth(f.county.gridTick));
    const r = catchUp(f.county, f.now + 86_400_000, 1e9);
    expect(r.done).toBe(true);
    expect(t.tick).toBeGreaterThan(40);
    expect(checkCounty(f.county)).toEqual([]);
    expect(t.alerts).toEqual([]);
  });

  it('pins the fixture hashes (update deliberately when the contract changes)', () => {
    expect(FIXTURE_KINDS.map((k) => stateHash(fixture(k).county.towns[fixture(k).town]))).toMatchInlineSnapshot(`
      [
        "8bbb2d40de95af14",
        "964cc3be5949da71",
        "6bdbc7f002aaea4f",
      ]
    `);
  });
});
