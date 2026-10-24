// WP2e development (spec §5.2 steps 2–4, §2.3, §3.3, A11, A12, A23, A24):
// the growth, level-up and decline chances, the A24 stride, the Builders cap
// and its seeded ranking, Homes tiers and hotels at growth, declines, the
// supply count, incidents and their 2% cap, repairs, the founders' carts,
// the month memo, and the acceptance test: Bramble's three founding steps
// give 60–120 residents after the twelve sprint taps (§1.5, G13).

import { describe, expect, it } from 'vitest';
import { brambleSteps, sprintTaps } from '../../../../../scripts/hometowns/develop-kit';
import { fixture, newCounty } from '../../../../../scripts/hometowns/fixture';
import { monthContext } from '../../../../../scripts/hometowns/people-kit';
import { applyCommand } from './commands';
import { constructionStep } from './construction';
import { commitTown, lineIndex, population } from './core';
import { neutral } from './derived';
import {
  buildersPerTick,
  buildersTurnedAway,
  closedTicks,
  declineChance,
  desirability,
  explainGrowth,
  fallbackPlace,
  growChance,
  hasMonthMemo,
  incidentsLeft,
  levelCap,
  levelUpChance,
  lvLevel,
  stepDevelop,
  stepDevelopMemo,
  stepSupply,
  stridePerm,
  strideOrder,
  supplyOf,
  upgradingFrom,
  visitedOn,
} from './develop';
import { checkTown } from './invariants';
import { paramsFor, type Params } from './params';
import { h32, STREAMS } from './rand';
import { readTileLog } from './records';
import { STEPS } from './steps';
import { makeContext, tickTown } from './tick';
import {
  B_DAMAGED,
  CELLS,
  MARK_DAMAGED,
  VARIANT_HOTEL,
  buildingUse,
  cellOf,
  commitPlanes,
  encodeCells,
  lvlLevel,
  lvlTier,
  makeLvl,
  newBuilding,
  pairGet,
  pairSet,
  planesForWrite,
  planesOf,
  roadUse,
  tileIndex,
  zoneUse,
} from './tiles';
import { buildingIndex } from './content';
import { placeCost, reindexBuildings } from './ops';
import { stateHash } from './index';
import {
  METER_FARMS,
  METER_LEISURE,
  METER_OFFICES,
  METER_SHOPS,
  STAGE_C,
  STAGE_P,
  STAGE_W,
  Z_FARMS,
  Z_HOMES,
  Z_LEISURE,
  Z_OFFICES,
  Z_SHOPS,
  cohort,
  person,
  type CountyState,
  type TickContext,
  type TownState,
} from './types';

const P = paramsFor('v1');
const D = P.develop;

/** A mutable copy of v1 with some develop knobs changed (tests only). */
function tuned(over: Partial<Record<keyof Params['develop'], unknown>>): Params {
  const p = JSON.parse(JSON.stringify(P)) as { develop: Record<string, unknown> };
  Object.assign(p.develop, over);
  return p as unknown as Params;
}
/** Growth and level-up become certain for any z above zMid: the scan's rules are then what the test sees. */
const CERTAIN = tuned({ pGrow: 1, pLevel: 1, zScale: 0.001 });

interface Town {
  c: CountyState;
  t: TownState;
  now: number;
}

/** A founded town already on the grid (its fortnight done), with nothing built but the County Road and Town Hall. */
function town(seed = 5, site = 0, sprinting = false): Town {
  const c = newCounty(seed);
  const now = c.epoch + 3_600_000;
  applyCommand(c, 'a', { type: 'found', site, nameParts: ['Oak', 'vale'], avatar: 'badger', flag: 1 }, now);
  const t = c.towns[0];
  if (!sprinting) {
    // On the grid, at a month start, older than 21 days (no founders' carts).
    t.sprintLeft = 0;
    t.gridBase = t.foundGrid;
    t.tick = 2000;
  }
  return { c, t, now };
}

const LANE = roadUse(0);
/** A lane along row y from x0 to x1 (inclusive). */
function road(t: TownState, y: number, x0 = 16, x1 = 47): void {
  const p = planesForWrite(t);
  for (let x = x0; x <= x1; x++) p.use[tileIndex(x, y)] = LANE;
  commitPlanes(t);
}
function paint(t: TownState, tiles: readonly number[], zone: number, level = 0, tier = 0, age = 0): void {
  const p = planesForWrite(t);
  for (const i of tiles) {
    p.use[i] = zoneUse(zone);
    p.lvl[i] = level > 0 ? makeLvl(level, tier, 0) : 0;
    p.age[i] = age;
  }
  commitPlanes(t);
}
function row(y: number, x0: number, x1: number): number[] {
  const out: number[] = [];
  for (let x = x0; x <= x1; x++) out.push(tileIndex(x, y));
  return out;
}
function setLv(t: TownState, value: number | ((cell: number) => number)): void {
  const a = new Uint8Array(CELLS);
  for (let c = 0; c < CELLS; c++) a[c] = typeof value === 'number' ? value : value(c);
  t.lv = encodeCells(a);
}

interface TickOpts {
  params?: Params;
  sprint?: boolean;
  mishaps?: 'mild' | 'off';
}
/** One tick of WP1's construction step then the development step, as the driver runs them (no month step). */
function devTick(x: Town, o: TickOpts = {}): TickContext {
  const { c, t } = x;
  const base = makeContext(c, 0, t.tick, o.sprint ? x.now + t.tick * 10_000 : null);
  const ctx: TickContext = { ...base, params: o.params ?? base.params, mishaps: o.mishaps ?? base.mishaps };
  constructionStep(t, ctx);
  stepDevelop(t, ctx);
  commitTown(t);
  t.tick += 1;
  return ctx;
}
const events = (t: TownState, kind: string, since = 0) => readTileLog(t, since).filter((e) => e.kind === kind);

// ---- The chances ---------------------------------------------------------------------------

describe('the §5.2 chances', () => {
  it('grow ≈1% at z = −40, ≈10% at 0 and 29% at +60', () => {
    expect(growChance(-40, D)).toBeCloseTo(0.0103, 4);
    expect(growChance(0, D)).toBeCloseTo(0.1018, 4);
    expect(growChance(60, D)).toBeCloseTo(0.2897, 4);
    // Exactly the formula: 0.30 · σ((z − 10)/15).
    for (const z of [-40, 0, 10, 60]) expect(growChance(z, D)).toBeCloseTo(0.3 / (1 + Math.exp(-(z - 10) / 15)), 6);
  });

  it('level up at 0.25·σ((z − 10)/15); decline ≈0.35% at z = 0 and 5% at −40', () => {
    expect(levelUpChance(10, D)).toBeCloseTo(0.125, 9);
    expect(levelUpChance(60, D)).toBeCloseTo((0.25 / 0.3) * growChance(60, D), 9);
    expect(declineChance(0, D)).toBeCloseTo(0.00344, 5);
    expect(declineChance(-40, D)).toBeCloseTo(0.05, 9);
    expect(declineChance(60, D)).toBeLessThan(1e-4);
  });

  it('Builders = 6 + Pop/250 starts a month, a quarter each tick', () => {
    expect(buildersPerTick(0, D)).toBe(1.5);
    expect(buildersPerTick(1000, D)).toBe(2.5);
  });
});

// ---- Level caps and desirability ---------------------------------------------------------------

describe('level caps (§3.3) and desirability', () => {
  it('land value allows L2 at 35, L3 70, L4 115, L5 165; the tier caps and the flood plain bind too', () => {
    expect([1, 34, 35, 69, 70, 115, 164, 165, 250].map((v) => lvLevel(v, D))).toEqual([1, 1, 2, 2, 3, 4, 4, 5, 5]);
    const { t } = town();
    t.tier = 0;
    expect(levelCap(t, Z_HOMES, 250, 0, D)).toBe(2);
    expect(levelCap(t, Z_SHOPS, 250, 0, D)).toBe(1);
    expect(levelCap(t, Z_OFFICES, 250, 0, D)).toBe(0);
    t.tier = 4;
    expect(levelCap(t, Z_HOMES, 120, 0, D)).toBe(4);
    t.siteKind = 'river';
    expect(levelCap(t, Z_HOMES, 250, 1 << 6, D)).toBe(3); // TF_RIVER: no L4+ on the flood plain
    expect(levelCap(t, Z_HOMES, 250, 0, D)).toBe(5);
  });

  it('computes L_k(x) from the §5.2 formulas, clamped to ±100', () => {
    const x = { ...fallbackPlace(100, 50), noise: 70, safety: 80, crime: 20, school: 60, nature: 40, cust: 70, visitor: 60, freight: 80, fun: 30, culture: 50, transit: 60 };
    expect(desirability(Z_HOMES, x, D)).toBeCloseTo(0.7 * 40 + 0.25 * 30 + 0.15 * (50 - 30) - 0.6 * 15 - 0.3 * 20, 9);
    expect(desirability(Z_SHOPS, x, D)).toBeCloseTo(0.6 * 20 + 0.25 * 40, 9);
    expect(desirability(Z_LEISURE, x, D)).toBeCloseTo(0.5 * 20 + 0.3 * 40 + 0.15 * 20, 9);
    expect(desirability(3, x, D)).toBeCloseTo(0.7 * 30 + 0.25 * -30, 9); // Industry: cheap land near freight
    expect(desirability(Z_OFFICES, x, D)).toBeCloseTo(0.5 * 10 + 0.3 * 20 + 0.2 * 20, 9);
    expect(desirability(Z_HOMES, { ...x, lv: 250, poll: 0, noise: 0 }, D)).toBe(100);
  });
});

// ---- The stride (A24) ----------------------------------------------------------------------------

describe('the development stride (A24)', () => {
  it('perm(i) = (i·2,654,435,761 + seed) mod 4096 is a bijection over all 4,096 tiles', () => {
    for (const seed of [0, 1, 77, 0xdeadbeef, 4294967295]) {
      const order = strideOrder(seed, D.strideMul);
      expect(new Set(order).size).toBe(4096);
      for (const i of [0, 1, 99, 2048, 4095]) {
        const exact = Number((BigInt(i) * 2654435761n + BigInt(seed >>> 0)) % 4096n);
        expect(stridePerm(i, seed, D.strideMul)).toBe(exact);
        expect(order[exact]).toBe(i);
      }
    }
  });

  it('visits every tile exactly once in any four consecutive ticks, and every tile on a sprint tick', () => {
    const seed = 123456789;
    for (const start of [0, 1, 2, 3, 41]) {
      const seen = new Uint8Array(4096);
      for (let k = 0; k < 4; k++) for (let i = 0; i < 4096; i++) if (visitedOn(i, start + k, seed, D.strideMul)) seen[i]++;
      expect(seen.every((n) => n === 1)).toBe(true);
    }
    for (let i = 0; i < 4096; i += 97) expect(visitedOn(i, 5, seed, D.strideMul, true)).toBe(true);
  });

  it('a zoned tile takes its roll only on its own tick, once a month, whatever else is zoned', () => {
    const x = town(7);
    const { t } = x;
    road(t, 20);
    const tiles = [...row(21, 16, 47), ...row(22, 16, 47)];
    paint(t, tiles, Z_HOMES);
    setLv(t, 60);
    t.meters[0] = 100;
    const params = tuned({ pGrow: 1, zScale: 0.001, buildersBase: 4000 });
    const startedOn = new Map<number, number>();
    for (let k = 0; k < 4; k++) {
      const tick = t.tick;
      devTick(x, { params });
      for (const e of events(t, 'started', tick)) startedOn.set(e.tile, tick);
    }
    // Every zoned tile started exactly once, on the tick its stride slot came up.
    expect(startedOn.size).toBe(tiles.length);
    for (const [tile, tick] of startedOn) expect(visitedOn(tile, tick, t.seed, D.strideMul)).toBe(true);
    // Zoning more land changes nobody's slot: the slot is a function of the tile index alone.
    for (const i of tiles) expect(visitedOn(i, startedOn.get(i)!, t.seed, D.strideMul)).toBe(true);
  });
});

// ---- Growth, the Builders cap and ranking -------------------------------------------------------------

describe('growth and the Builders cap', () => {
  it('starts at most Builders/4 a tick (with a carry), highest z first', () => {
    const x = town(9, 0, true);
    const { t } = x;
    road(t, 20);
    const rich = row(21, 16, 31);
    const poor = row(21, 32, 47);
    paint(t, [...rich, ...poor], Z_HOMES);
    setLv(t, (c) => ((c & 31) < 16 ? 100 : 40)); // west half (x < 32) has the better land
    t.meters[0] = 100;
    const starts: number[] = [];
    for (let k = 0; k < 8; k++) {
      const tick = t.tick;
      devTick(x, { params: tuned({ pGrow: 1, zScale: 0.001, cartsPerTick: 0 }), sprint: true });
      starts.push(events(t, 'started', tick).length);
    }
    // Pop 0: 6 starts a month, 1.5 a tick: the carry makes it 1, 2, 1, 2, …
    expect(starts).toEqual([1, 2, 1, 2, 1, 2, 1, 2]);
    // Every start so far is on the better land.
    for (const e of events(t, 'started')) expect(rich).toContain(e.tile);
    expect(buildersTurnedAway(t)).toBeGreaterThan(0);
  });

  it('breaks ties by h32(seed, rank, tick, tile)', () => {
    const x = town(11, 0, true);
    const { t } = x;
    road(t, 20);
    const cell = [tileIndex(20, 21), tileIndex(21, 21)]; // one 2×2 cell: the same L
    paint(t, cell, Z_HOMES);
    setLv(t, 60);
    t.meters[0] = 100;
    const ctx = devTick(x, { params: CERTAIN, sprint: true });
    const [won] = events(t, 'started');
    const rank = (tile: number) => h32(t.seed, STREAMS.rank, tile, 0, ctx.tick);
    const expected = rank(cell[0]) <= rank(cell[1]) ? cell[0] : cell[1];
    expect(won.tile).toBe(expected);
  });

  it('chooses the eligible Homes tier with the highest meter (LV − 0.5·Pollution ≥ 60 for ££, 130 for £££)', () => {
    for (const [lv, want] of [
      [40, 0],
      [80, 1],
      [200, 1],
    ] as const) {
      const x = town(13, 0, true);
      const { t } = x;
      road(t, 20);
      const tile = tileIndex(20, 21);
      paint(t, [tile], Z_HOMES);
      setLv(t, lv);
      t.meters[0] = 20;
      t.meters[1] = 60;
      t.meters[2] = 40;
      devTick(x, { params: CERTAIN, sprint: true });
      expect(lvlTier(planesOf(t).lvl[tile])).toBe(want);
    }
  });

  it('grows Leisure as a hotel only where visitors reach it and bed demand exceeds the beds', () => {
    for (const [bedDemand, want] of [
      [500, VARIANT_HOTEL],
      [0, 0],
    ] as const) {
      const x = town(15);
      const { c, t } = x;
      t.tier = 2;
      road(t, 20);
      const tile = tileIndex(24, 21);
      paint(t, [tile], Z_LEISURE);
      setLv(t, 60);
      t.meters[METER_LEISURE] = 100;
      // A month memo whose fields put visitors at this cell.
      const m = monthContext(c, 0, { fields: { ...neutral.fields(t), visitorAccess: new Float64Array(CELLS).fill(90) } });
      stepDevelopMemo(t, m);
      t.marketMemo = { surplus: [0, 0], lowMonths: [0, 0, 0, 0, 0], sat: 60, visitors: 0, bedDemand, attrQ: 0, pull: 0, shopAppeal: 0 };
      for (let k = 0; k < 4; k++) devTick(x, { params: CERTAIN });
      expect(lvlLevel(planesOf(t).lvl[tile])).toBe(1);
      expect(lvlTier(planesOf(t).lvl[tile])).toBe(want);
    }
  });

  it('needs a road within 2 tiles, keeps Hamlet L1 free of power and water, and grows Offices straight to L3', () => {
    const x = town(17);
    const { c, t } = x;
    t.tier = 2;
    road(t, 20, 16, 30);
    const near = tileIndex(18, 22);
    const far = tileIndex(18, 23);
    const office = tileIndex(26, 21);
    paint(t, [near, far], Z_HOMES);
    paint(t, [office], Z_OFFICES);
    setLv(t, 120);
    t.meters[0] = 100;
    t.meters[METER_OFFICES] = 100;
    // Nothing is powered or watered: an L1 home does not care, an L3 office does (z − 100).
    const dark = { ...neutral.utilities(), powered: new Uint8Array(4096), watered: new Uint8Array(4096) };
    stepDevelopMemo(t, monthContext(c, 0, { utilities: dark }));
    for (let k = 0; k < 4; k++) devTick(x, { params: tuned({ pGrow: 1, zScale: 0.001, zMid: 10 }) });
    expect(lvlLevel(planesOf(t).lvl[near])).toBe(1);
    expect(lvlLevel(planesOf(t).lvl[far])).toBe(0);
    expect(explainGrowth(t, far, P).blocked).toBe('noRoad');
    // The dark office's score is 100 + L − 100 − ... below zMid, so even a "certain" roll fails.
    expect(lvlLevel(planesOf(t).lvl[office])).toBe(0);
    stepDevelopMemo(t, monthContext(c, 0, {}));
    for (let k = 0; k < 4; k++) devTick(x, { params: tuned({ pGrow: 1, zScale: 0.001 }) });
    expect(lvlLevel(planesOf(t).lvl[office])).toBe(3);
    expect(events(t, 'started').find((e) => e.tile === office)?.value).toBe(3);
  });
});

// ---- Level-ups, declines and the supply count -----------------------------------------------------------

describe('level-ups, declines and the supply count', () => {
  it('a level-up keeps the old homes open and counts the increment as pipeline until it completes', () => {
    const x = town(19);
    const { t } = x;
    road(t, 20);
    const tile = tileIndex(20, 21);
    paint(t, [tile], Z_HOMES, 1, 0, 6);
    setLv(t, 60);
    t.meters[0] = 100;
    t.people[person(STAGE_W, 0)] = 8; // full: occupancy ≥ 90%
    t.books.popOpen = 8;
    let s = supplyOf(t, P);
    expect([s.cap[0], s.pipeline[0], s.built[Z_HOMES], s.zoned[Z_HOMES]]).toEqual([8, 0, 1, 1]);
    for (let k = 0; k < 4 && upgradingFrom(t, tile) === 0; k++) devTick(x, { params: CERTAIN });
    expect(upgradingFrom(t, tile)).toBe(1);
    expect(lvlLevel(planesOf(t).lvl[tile])).toBe(2);
    expect(planesOf(t).age[tile]).toBe(0);
    s = supplyOf(t, P);
    expect([s.cap[0], s.pipeline[0], s.built[Z_HOMES]]).toEqual([8, 12, 1]);
    devTick(x, { params: CERTAIN });
    devTick(x, { params: CERTAIN });
    s = supplyOf(t, P);
    expect([s.cap[0], s.pipeline[0]]).toEqual([20, 0]);
    expect(upgradingFrom(t, tile)).toBe(0);
    expect(events(t, 'levelUp').map((e) => e.tile)).toEqual([tile]);
  });

  it('will not level up an under-filled, too young or capped tile', () => {
    const x = town(21);
    const { t } = x;
    road(t, 20);
    const young = tileIndex(20, 21);
    const empty = tileIndex(24, 21);
    const capped = tileIndex(28, 21);
    paint(t, [young], Z_HOMES, 1, 0, 2);
    paint(t, [empty], Z_HOMES, 1, 0, 9);
    paint(t, [capped], Z_SHOPS, 1, 0, 9); // Hamlet Shops cap at L1
    setLv(t, 60);
    t.meters[0] = 100;
    t.meters[METER_SHOPS] = 100;
    for (let k = 0; k < 4; k++) devTick(x, { params: CERTAIN });
    expect(events(t, 'levelUp')).toEqual([]);
  });

  it('counts jobs with the A2 entry mix, hotel beds, and closed tiles as pipeline', () => {
    const { t } = town(23);
    t.tier = 2;
    const shop = tileIndex(20, 21);
    const hotel = tileIndex(22, 21);
    const home = tileIndex(24, 21);
    paint(t, [shop], Z_SHOPS, 2);
    paint(t, [home], Z_HOMES, 3, 1);
    const p = planesForWrite(t);
    p.use[hotel] = zoneUse(Z_LEISURE);
    p.lvl[hotel] = makeLvl(3, VARIANT_HOTEL, 0);
    commitPlanes(t);
    pairSet(t.marks, home, MARK_DAMAGED);
    const s = supplyOf(t, P);
    const l2 = P.labour.entryMixL2;
    expect(s.jobs.slice(2 * 3, 2 * 3 + 3)).toEqual([8 * l2[0], 8 * l2[1], 8 * l2[2]]); // Shops are sector 2
    expect(s.jobs.slice(3 * 3, 3 * 3 + 3).reduce((a, b) => a + b, 0)).toBeCloseTo(18, 9); // Leisure sector 3, L3 mix
    expect(s.beds).toBe(20);
    expect(s.cap[1]).toBe(0);
    expect(s.pipeline[1]).toBe(50);
    expect(s.built[Z_HOMES]).toBe(1);
  });

  it('declines one level: L1 becomes an empty "For Sale" lot, an office below L3 empties; no road means p 0.25', () => {
    const x = town(25);
    const { t } = x;
    t.tier = 2;
    const home = tileIndex(20, 30); // no road anywhere near
    const office = tileIndex(24, 30);
    paint(t, [home], Z_HOMES, 2);
    paint(t, [office], Z_OFFICES, 3);
    for (let k = 0; k < 4; k++) devTick(x, { params: tuned({ noRoadDecline: 1 }) });
    expect(lvlLevel(planesOf(t).lvl[home])).toBe(1);
    expect(lvlLevel(planesOf(t).lvl[office])).toBe(0);
    for (let k = 0; k < 4; k++) devTick(x, { params: tuned({ noRoadDecline: 1 }) });
    expect(lvlLevel(planesOf(t).lvl[home])).toBe(0);
    expect(planesOf(t).use[home]).toBe(zoneUse(Z_HOMES)); // still zoned
    expect(events(t, 'declined').map((e) => e.value)).toEqual(expect.arrayContaining([1, 0, 0]));
    expect(checkTown(t)).toEqual([]);
  });

  it('forces a decline after 3 months without power or water, and after 6 months under 40% full', () => {
    const x = town(27);
    const { c, t } = x;
    road(t, 20);
    const dark = tileIndex(20, 21);
    const lonely = tileIndex(24, 21);
    paint(t, [dark], Z_HOMES, 2, 0, 9);
    paint(t, [lonely], Z_SHOPS, 1, 0, 9);
    setLv(t, 60);
    t.meters[0] = -100; // nothing levels up
    t.meters[METER_SHOPS] = -100;
    const powered = new Uint8Array(4096).fill(1);
    powered[dark] = 0;
    const lab = { ...neutral.labour(), sectorJobs: [0, 0, 3, 0, 0], sectorFilled: [0, 0, 0, 0, 0], fillRate: [0, 0, 0, 0, 0] };
    const quiet = tuned({ pDecline: 0 }); // only the forced rules act
    for (let month = 1; month <= 6; month++) {
      stepDevelopMemo(t, monthContext(c, 0, { utilities: { ...neutral.utilities(), powered }, labour: lab }));
      for (let k = 0; k < 4; k++) devTick(x, { params: quiet });
      if (month < 3) expect(lvlLevel(planesOf(t).lvl[dark])).toBe(2);
      if (month === 3) expect(lvlLevel(planesOf(t).lvl[dark])).toBe(1);
      if (month < 6) expect(lvlLevel(planesOf(t).lvl[lonely])).toBe(1);
    }
    expect(lvlLevel(planesOf(t).lvl[lonely])).toBe(0);
  });

  it('pauses decline rolls while an Away town is at its 5% loss cap (§2.4, A34)', () => {
    const x = town(29);
    const { t } = x;
    const home = tileIndex(20, 30);
    paint(t, [home], Z_HOMES, 1);
    t.people[person(STAGE_W, 0)] = 95;
    t.books.popOpen = 95;
    const at = makeContext(x.c, 0, t.tick).at;
    t.away = { lastHelloAt: at - 3 * 86_400_000, weekStartPop: 100, weekLoss: 5 };
    for (let k = 0; k < 4; k++) devTick(x, { params: tuned({ noRoadDecline: 1 }) });
    expect(lvlLevel(planesOf(t).lvl[home])).toBe(1);
    t.away.lastHelloAt = at + 4 * 1_800_000; // back: no longer Away
    for (let k = 0; k < 4; k++) devTick(x, { params: tuned({ noRoadDecline: 1 }) });
    expect(lvlLevel(planesOf(t).lvl[home])).toBe(0);
  });

  it('ages built tiles a month at a time, from 0 at each level change', () => {
    const x = town(31);
    const { t } = x;
    road(t, 20);
    const tile = tileIndex(20, 21);
    paint(t, [tile], Z_HOMES, 1, 0, 254);
    t.meters[0] = -100;
    for (let k = 0; k < 4; k++) devTick(x, { params: tuned({ pDecline: 0 }) });
    expect(planesOf(t).age[tile]).toBe(255);
    for (let k = 0; k < 8; k++) devTick(x, { params: tuned({ pDecline: 0 }) });
    expect(planesOf(t).age[tile]).toBe(255);
  });

  it('flags meters A9 cannot reach: ££ homes need land value, Offices need Town and LV 70', () => {
    const { c, t } = town(33);
    setLv(t, 40);
    const m = monthContext(c, 0);
    stepSupply(t, m);
    expect(m.derived.development!.reachableHomes).toEqual([true, false, false]);
    const zone = m.derived.development!.reachableZone;
    expect([zone[Z_HOMES], zone[Z_SHOPS], zone[Z_OFFICES], zone[Z_FARMS], zone[Z_LEISURE]]).toEqual([true, true, false, true, false]);
    t.tier = 2;
    setLv(t, 140);
    const r = supplyOf(t, P);
    expect(r.reachableHomes).toEqual([true, true, true]);
    expect(r.reachableZone[Z_OFFICES]).toBe(true);
  });
});

// ---- Incidents and repairs ----------------------------------------------------------------------------

describe('incidents (§5.2 step 3)', () => {
  /** A town of 1,000 built L1 homes with no fire cover. */
  function busyTown(seed: number): Town {
    const x = town(seed);
    const { t } = x;
    const tiles: number[] = [];
    // North of the County Road's end and the Town Hall (y < 44), lanes every fifth row.
    for (let y = 0; y < 44; y++) {
      if (y % 5 === 0) road(t, y, 0, 63);
      else for (let xx = 0; xx < 64; xx++) tiles.push(tileIndex(xx, y));
    }
    paint(t, tiles.slice(0, 1000), Z_HOMES, 1, 0, 3);
    t.meters[0] = -100;
    return x;
  }

  it('closes at most 2% of buildings a month, whatever the risk', () => {
    const x = busyTown(35);
    const certain = tuned({ incidentBase: 1, pDecline: 0 });
    for (let month = 0; month < 3; month++) {
      const since = x.t.tick;
      for (let k = 0; k < 4; k++) devTick(x, { params: certain });
      const n = events(x.t, 'incident', since).length;
      // 1,001 buildings (the Town Hall too): 2% is 20.02 a month, so 20 (the carry gives the 21st later).
      expect(n).toBeGreaterThanOrEqual(20);
      expect(n).toBeLessThanOrEqual(21);
    }
    expect(incidentsLeft(x.t)).toBeGreaterThanOrEqual(0);
  });

  it('is off with Mishaps Off and during the Founding Fortnight', () => {
    const certain = tuned({ incidentBase: 1, pDecline: 0 });
    const x = busyTown(37);
    for (let k = 0; k < 8; k++) devTick(x, { params: certain, mishaps: 'off' });
    expect(events(x.t, 'incident')).toEqual([]);
    const y = busyTown(37);
    for (let k = 0; k < 8; k++) devTick(y, { params: certain, sprint: true });
    expect(events(y.t, 'incident')).toEqual([]);
  });

  it('at v1 rates is rare: well under 2% of an uncovered town a month', () => {
    const x = busyTown(39);
    for (let k = 0; k < 16; k++) devTick(x, { params: tuned({ pDecline: 0 }) });
    const n = events(x.t, 'incident').length;
    expect(n).toBeLessThanOrEqual(20); // 0.2% of 1,000 a month is about 8 in 4 months; the cap would allow 80
  });

  it('closes a tile for 4 ticks (its homes count as pipeline), then the Deputy reopens it for free', () => {
    const x = busyTown(41);
    const { t } = x;
    const certain = tuned({ incidentBase: 1, pDecline: 0 });
    devTick(x, { params: certain });
    const [hit] = events(t, 'incident');
    expect(pairGet(t.marks, hit.tile) & MARK_DAMAGED).toBeTruthy();
    expect(closedTicks(t, hit.tile)).toBe(D.incidentTicks);
    const before = supplyOf(t, P);
    expect(before.pipeline[0]).toBeGreaterThanOrEqual(8);
    const reserves = t.money.reserves;
    for (let k = 0; k < D.incidentTicks; k++) devTick(x, { params: tuned({ pDecline: 0, incidentCap: 0 }) });
    expect(pairGet(t.marks, hit.tile) & MARK_DAMAGED).toBe(0);
    expect(events(t, 'repaired').map((e) => e.tile)).toContain(hit.tile);
    expect(t.money.reserves).toBe(reserves); // private repairs are the owner's
    expect(checkTown(t)).toEqual([]);
  });

  it('repairs a civic building at 5% of its cost unless fire cover there is above 50, and only with the order on', () => {
    for (const [fire, fixOn] of [
      [0, true],
      [80, true],
      [0, false],
    ] as const) {
      const x = town(43);
      const { c, t } = x;
      const kind = buildingIndex('schoolHouse');
      t.buildings.push(newBuilding(kind, 20, 20, 0, 0, 1));
      reindexBuildings(t);
      commitPlanes(t);
      const cov = neutral.coverage(t);
      cov.cov[1] = new Float64Array(CELLS).fill(fire); // COVERAGES[1] is fire
      stepDevelopMemo(t, monthContext(c, 0, { coverage: cov }));
      for (const o of t.orders) if (o.kind === 'fixDamaged') o.on = fixOn;
      t.buildings[1][B_DAMAGED] = D.incidentTicks;
      const reserves = t.money.reserves;
      const repairs = t.books.lines[lineIndex('repairs')];
      for (let n = 0; n < D.incidentTicks; n++) devTick(x, { params: tuned({ incidentCap: 0 }) });
      const expected = fire > D.repairFreeFireCov || !fixOn ? 0 : Math.round(placeCost(t, kind, P) * D.repairShare);
      if (fire === 0 && fixOn) expect(expected).toBeGreaterThan(0);
      expect(reserves - t.money.reserves).toBe(expected);
      expect(repairs - t.books.lines[lineIndex('repairs')]).toBe(expected);
      // With the order off the Deputy waits: the building stays closed until it is switched back on.
      expect(t.buildings[1][B_DAMAGED]).toBe(fixOn ? 0 : 1);
    }
  });
});

// ---- Founders' carts ------------------------------------------------------------------------------------

describe("founders' carts (§2.3, A12)", () => {
  it('bring min(20, £ vacancy) a tick, half Workers and half Families, never beyond the homes', () => {
    const x = town(45, 0, true);
    const { t } = x;
    road(t, 20);
    paint(t, row(21, 16, 18), Z_HOMES, 1); // 24 homes
    devTick(x, { sprint: true, params: tuned({ pGrow: 0 }) });
    expect(t.people[person(STAGE_W, 0)]).toBe(10);
    expect(t.people[person(STAGE_P, 0)]).toBe(5);
    expect(t.people[person(STAGE_C, 0)]).toBe(5);
    devTick(x, { sprint: true, params: tuned({ pGrow: 0 }) });
    expect(population(t)).toBe(24);
    devTick(x, { sprint: true, params: tuned({ pGrow: 0 }) });
    expect(population(t)).toBe(24);
    expect(t.books.pop[6]).toBe(24); // the 'carts' flow
    expect(checkTown(t)).toEqual([]);
  });

  it('put those who found no home on the £ waiting list, up to a month of carts', () => {
    const x = town(47, 0, true);
    const { t } = x;
    for (let k = 0; k < 10; k++) devTick(x, { sprint: true, params: tuned({ pGrow: 0 }) });
    expect(t.applicants[cohort(0, 0)] + t.applicants[cohort(0, 1)]).toBe(80);
    expect(t.applicants[cohort(0, 0)]).toBe(40);
    expect(population(t)).toBe(0);
  });

  it('stop at 300 people and after 21 days', () => {
    const x = town(49);
    const { t } = x;
    paint(t, row(21, 16, 47), Z_HOMES, 2); // 640 homes
    t.people[person(STAGE_W, 0)] = 300;
    t.books.popOpen = 300;
    devTick(x, { params: tuned({ pGrow: 0 }) });
    expect(population(t)).toBe(300);
    t.people[person(STAGE_W, 0)] = 100;
    t.books.popOpen = 100;
    t.tick = 21 * 48 + 12;
    devTick(x, { params: tuned({ pGrow: 0 }) });
    expect(population(t)).toBe(100);
    t.tick = 21 * 48 + 8;
    devTick(x, { params: tuned({ pGrow: 0 }) });
    expect(population(t)).toBe(120);
  });
});

// ---- The memo and determinism ------------------------------------------------------------------------------

describe('the month memo and determinism', () => {
  it('stores last month\'s L for zoned cells and uses it for the next four ticks', () => {
    const { c, t } = town(51);
    road(t, 20);
    const tile = tileIndex(20, 21);
    paint(t, [tile], Z_SHOPS);
    setLv(t, 60);
    expect(hasMonthMemo(t)).toBe(false);
    const before = explainGrowth(t, tile, P);
    expect(before.terms.find(([k]) => k === 'grow.desirability')![1]).toBeCloseTo(desirability(Z_SHOPS, fallbackPlace(60, 0), D), 9);
    const fields = { ...neutral.fields(t), custAccess: new Float64Array(CELLS).fill(100) };
    stepDevelopMemo(t, monthContext(c, 0, { fields }));
    expect(hasMonthMemo(t)).toBe(true);
    const after = explainGrowth(t, tile, P);
    const want = Math.round(desirability(Z_SHOPS, { ...fallbackPlace(60, 0), cust: 100, crime: 0, safety: 100 }, D));
    expect(after.terms.find(([k]) => k === 'grow.desirability')![1]).toBe(want);
    expect(cellOf(tile)).toBeGreaterThan(0);
  });

  it('a revived town (JSON round trip mid-month) continues exactly as one that never stopped', () => {
    const run = (revive: boolean) => {
      const f = fixture('town');
      let c = f.county;
      for (let k = 0; k < 6; k++) tickTown(c.towns[f.town], makeContext(c, f.town, c.towns[f.town].tick));
      if (revive) c = JSON.parse(JSON.stringify(c)) as CountyState;
      for (let k = 0; k < 6; k++) tickTown(c.towns[f.town], makeContext(c, f.town, c.towns[f.town].tick));
      const t = c.towns[f.town];
      expect(t.alerts).toEqual([]);
      return stateHash(t);
    };
    const a = run(false);
    expect(run(true)).toBe(a);
  });

  it('reads a damaged or foreign dev string as empty instead of failing', () => {
    const x = town(53);
    x.t.dev = 'not base64!|###';
    expect(() => devTick(x)).not.toThrow();
    expect(x.t.dev.startsWith('AQ')).toBe(true);
  });

  it('runs the real month for every fixture alert-free, books balanced', () => {
    for (const kind of ['hamlet', 'metropolis'] as const) {
      const f = fixture(kind);
      const t = f.county.towns[f.town];
      for (let k = 0; k < 8; k++) tickTown(t, makeContext(f.county, f.town, t.tick), STEPS);
      expect(t.alerts, kind).toEqual([]);
      expect(checkTown(t), kind).toEqual([]);
      expect(hasMonthMemo(t)).toBe(true);
    }
  });
});

// ---- The acceptance test: a Founding Fortnight (§1.5, A11, A12, G13) ---------------------------------------

describe("Bramble's founding (§1.5, G13)", () => {
  const results: { seed: number; site: number; pop: number[]; meters3: number[] }[] = [];
  for (let seed = 1; seed <= 4; seed++)
    for (let site = 0; site < 6; site++) {
      const c = newCounty(seed);
      const now = c.epoch + 3_600_000;
      applyCommand(c, 'a', { type: 'found', site, nameParts: ['Sunny', 'vale'], avatar: 'badger', flag: 1 }, now);
      brambleSteps(c, 'a', now + 1000);
      const r = sprintTaps(c, 'a', now + 1000);
      results.push({ seed, site, pop: r.pop, meters3: r.meters[2] });
    }

  it('gives 60–120 residents after the 12 sprint taps in ≥ 90% of foundings, and none far outside', () => {
    const finals = results.map((r) => r.pop[11]);
    const inBand = finals.filter((n) => n >= 60 && n <= 120).length;
    expect(inBand / finals.length).toBeGreaterThanOrEqual(0.9);
    for (const n of finals) {
      expect(n).toBeGreaterThanOrEqual(40);
      expect(n).toBeLessThanOrEqual(120);
    }
  });

  it('grows from the first taps (carts follow the cottages) and keeps Homes £, Shops and Farms wanted at tap 3', () => {
    for (const r of results) {
      expect(r.pop[5]).toBeGreaterThan(0);
      expect(r.pop[11]).toBeGreaterThanOrEqual(r.pop[5] - 4);
      expect(r.meters3[0]).toBeGreaterThan(0);
      expect(r.meters3[METER_SHOPS]).toBeGreaterThan(0);
      expect(r.meters3[METER_FARMS]).toBeGreaterThan(0);
    }
  });

  it('is the identical fortnight for the same seed, site and taps', () => {
    const again = () => {
      const c = newCounty(2);
      const now = c.epoch + 3_600_000;
      applyCommand(c, 'a', { type: 'found', site: 3, nameParts: ['Sunny', 'vale'], avatar: 'badger', flag: 1 }, now);
      brambleSteps(c, 'a', now + 1000);
      sprintTaps(c, 'a', now + 1000);
      return stateHash(c.towns[0]);
    };
    expect(again()).toBe(again());
  });
});
