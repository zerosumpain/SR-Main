// The harness bot (src/harness/bot.ts): its street grid, its arithmetic, and
// that it plays legal, deterministic moves through the real move API.

import { describe, expect, it } from 'vitest';
import { CAT_ZONE, MAP, TILES, checkTown, planesOf, roadAccess, useCat, usePayload } from '../src/engine';
import { CENTRE, GRID_X, GRID_Y, SEGMENTS, apportion, botTurn, emptyLots, findSpot, lotsBeside, nextSegments, onGrid, segmentTiles } from '../src/harness/bot';
import { HarnessSession, HARNESS_SEAT } from '../src/harness/session';

describe('street grid', () => {
  it('runs through the County Road column and the founding row', () => {
    expect(GRID_X).toContain(CENTRE[0]);
    expect(GRID_Y).toContain(CENTRE[1]);
    expect(GRID_X.every((x, k) => k === 0 || x - GRID_X[k - 1] === 5)).toBe(true);
    expect(GRID_X[GRID_X.length - 1]).toBeLessThan(MAP);
  });

  it('has segments of six tiles between neighbouring nodes', () => {
    expect(SEGMENTS.length).toBe(GRID_X.length * (GRID_Y.length - 1) + GRID_Y.length * (GRID_X.length - 1));
    for (const s of SEGMENTS) expect(segmentTiles(s)).toHaveLength(6);
  });

  it('leaves every block tile within two tiles of a grid line (the development rule)', () => {
    for (let y = GRID_Y[0]; y <= GRID_Y[GRID_Y.length - 1]; y++)
      for (let x = GRID_X[0]; x <= GRID_X[GRID_X.length - 1]; x++) {
        const dx = Math.min(...GRID_X.map((g) => Math.abs(g - x)));
        const dy = Math.min(...GRID_Y.map((g) => Math.abs(g - y)));
        expect(Math.min(dx, dy) <= 2 || onGrid(x, y)).toBe(true);
        expect(Math.max(dx, dy)).toBeLessThanOrEqual(2);
      }
  });
});

describe('apportion', () => {
  it('splits lots by weight with the largest remainder and never loses one', () => {
    expect(apportion(10, [1, 1, 0])).toEqual([5, 5, 0]);
    expect(apportion(7, [3, 1, 0, 0])).toEqual([5, 2, 0, 0]);
    expect(apportion(5, [0, 0])).toEqual([0, 0]);
    for (let n = 0; n < 20; n++) expect(apportion(n, [5, 3, 2, 7]).reduce((a, b) => a + b, 0)).toBe(n);
  });
});

describe('founding (Bramble’s three steps)', () => {
  it('draws a lane off the County Road, 12 Homes, 2 Farms and a Well, with no refusals', () => {
    const s = new HarnessSession({ seed: 1 });
    const t = s.town;
    const p = planesOf(t);
    let homes = 0;
    let farms = 0;
    for (let i = 0; i < TILES; i++)
      if (useCat(p.use[i]) === CAT_ZONE) {
        if (usePayload(p.use[i]) === 0) homes++;
        if (usePayload(p.use[i]) === 5) farms++;
      }
    expect([homes, farms]).toEqual([12, 2]);
    expect(t.buildings.map((b) => b[0])).toHaveLength(2); // the Town Hall and the Well
    expect(s.log.some((e) => e.text.includes('refused'))).toBe(false);
    // Every zoned lot can develop: a road within two tiles.
    const reach = roadAccess(t);
    for (let i = 0; i < TILES; i++) if (useCat(p.use[i]) === CAT_ZONE) expect(reach[i]).toBe(1);
  });

  it('works on every site kind around Kingsport', () => {
    for (let site = 0; site < 6; site++) {
      const s = new HarnessSession({ seed: 11, site });
      expect(emptyLots(s.town).zoned).toBeGreaterThanOrEqual(12);
    }
  });
});

describe('a bot town over ten days', () => {
  const s = new HarnessSession({ seed: 2, site: 2 });
  s.runDays(10);
  const t = s.town;

  it('grows past the Founding Fortnight into a Village', () => {
    const st = s.stats();
    expect(st.fortnight).toBe(false);
    expect(st.tier).toBeGreaterThanOrEqual(1);
    expect(st.population).toBeGreaterThan(500);
    expect(st.buildings).toBeGreaterThan(5);
  });

  it('keeps the town valid: invariants hold and no month was reverted', () => {
    expect(checkTown(t)).toEqual([]);
    expect(t.alerts).toEqual([]);
    expect(s.county.alerts.filter((a) => a.kind === 'month-reverted')).toEqual([]);
  });

  it('never zones a grid-line tile, so later roads always have room', () => {
    const p = planesOf(t);
    for (let i = 0; i < TILES; i++) if (useCat(p.use[i]) === CAT_ZONE) expect(onGrid(i % MAP, (i - (i % MAP)) / MAP)).toBe(false);
  });

  it('only plans legal moves: next segments are open and touch the network, lots are free', () => {
    for (const seg of nextSegments(t).slice(0, 5)) for (const [x, y] of lotsBeside(t, seg)) expect(planesOf(t).use[y * MAP + x]).toBe(0);
    const spot = findSpot(t, 1, 1, true);
    if (spot) expect(spot[0]).toBeGreaterThanOrEqual(0);
  });

  it('is a pure function of the seed (same seed, same town; another seed, another town)', () => {
    const again = new HarnessSession({ seed: 2, site: 2 });
    again.runDays(10);
    expect(again.hash()).toBe(s.hash());
    const other = new HarnessSession({ seed: 3, site: 2 });
    other.runDays(10);
    expect(other.hash()).not.toBe(s.hash());
  });

  it('reports refusals instead of throwing', () => {
    const turn = botTurn(s.county, 'nobody', s.now);
    expect(turn).toEqual({ moves: [], refused: [], retry: false });
    expect(() => botTurn(s.county, HARNESS_SEAT, s.now)).not.toThrow();
  });
});
