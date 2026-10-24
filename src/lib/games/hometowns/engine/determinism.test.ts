// The determinism contract (spec §10.4 item 7) against the core with a small
// RNG-driven test economy plugged in through the step table: catch-up gives
// the same county for any chunk budget, for towns stepped in any order, and
// after a revive mid-way; the NaN guard reverts a poisoned month; the books
// balance and people are conserved.

import { describe, expect, it } from 'vitest';
import { foundAndSprint, newCounty } from '../../../../../scripts/hometowns/fixture';
import { applyCommand } from './commands';
import { catchUp, regionalDay } from './county';
import { flow, population, postMoney, postPeople } from './core';
import { countyHash, stateHash } from './index';
import { checkCounty } from './invariants';
import { CARRY_SCALE } from './num';
import { withSteps } from './steps';
import { catchUpTown } from './tick';
import { gridTickAt, napCheck, nextRegionalDayAt } from './clock';
import { constructionLeft, lvlLevel, pairSet, planesForWrite, planesOf, useCat, CAT_ZONE } from './tiles';
import { STAGE_C, STAGE_R, STAGE_W, person, type CountyState, type MonthContext, type TickContext, type TownState } from './types';

const DAY = 86_400_000;

/** Tick step: zoned lots start growing at random; founders' carts bring a few people. */
function testDevelop(t: TownState, ctx: TickContext): void {
  const p = planesOf(t);
  for (let k = 0; k < 8; k++) {
    const tile = ctx.rng('develop', k, 0) % 4096;
    if (useCat(p.use[tile]) === CAT_ZONE && lvlLevel(p.lvl[tile]) === 0 && constructionLeft(t, tile) === 0 && ctx.rng('develop', k, 1) % 3 === 0) {
      planesForWrite(t).lvl[tile] = 1;
      pairSet(t.construction, tile, 2);
    }
  }
  if (population(t) < 300) postPeople(t, 'carts', person(STAGE_W, 0), ctx.rng('develop', 99, 0) % 4);
}

/** Month step: births and deaths with carries, money with carries, Why terms. */
function testDemography(t: TownState, m: MonthContext): void {
  const w = t.people[person(STAGE_W, 0)];
  const births = flow(t, 'test.births', w * 0.013 + (m.rng('develop', 7, 0) % 100) / 300);
  postPeople(t, 'births', person(STAGE_C, 0), births);
  m.why.add('pop.births', births);
  const old = flow(t, 'test.retire', w * 0.011);
  const moved = Math.min(old, t.people[person(STAGE_W, 0)]);
  t.people[person(STAGE_W, 0)] -= moved;
  t.people[person(STAGE_R, 0)] += moved;
  const deaths = flow(t, 'test.deaths', t.people[person(STAGE_R, 0)] * 0.02);
  m.why.add('pop.deaths', postPeople(t, 'deaths', person(STAGE_R, 0), -deaths));
  postMoney(t, 'homesTax', population(t) * 3.37 + (m.rng('develop', 8, 0) % 1000) / 7);
  postMoney(t, 'upkeepCivic', -(250.5 + population(t) * 0.91));
}

const TEST_STEPS = withSteps({ develop: testDevelop, 'M9 demography': testDemography });

/** Three towns founded, sprinted and given a starter plan. */
function county(seed = 7): { c: CountyState; now: number } {
  const c = newCounty(seed);
  let now = c.epoch + 60_000;
  for (const [seat, site] of [['ann', 0], ['ben', 2], ['cat', 4]] as const) {
    const r = foundAndSprint(c, seat, site, now);
    now = r.now + 5_000;
    applyCommand(c, seat, {
      type: 'build',
      planId: `${seat}-start`,
      plan: [
        { op: 'road', kind: 'lane', path: [32, 43, 32, 28, 22, 28] },
        { op: 'zone', zone: 'homes', rect: [26, 29, 6, 4] },
        { op: 'zone', zone: 'farms', rect: [33, 30, 3, 2] },
        { op: 'place', id: 'well', x: 31, y: 40, rot: 0 },
      ],
    }, now);
  }
  return { c, now };
}

/** Runs a county with a fixed budget per call until it is caught up to `to`. */
function drain(c: CountyState, to: number, budget: number): number {
  let calls = 0;
  for (;;) {
    calls++;
    const day = c.dayIndex;
    const r = catchUp(c, to, budget, { steps: TEST_STEPS });
    if (r.done) return calls;
    // A27: an intermediate chunk neither writes nor emits, unless it ran a Regional Day.
    expect(r.changed).toBe(c.dayIndex !== day);
    expect(calls).toBeLessThan(100000);
  }
}

describe('determinism', () => {
  const { c: base, now } = county();
  const to = now + 2 * DAY + 5 * 3_600_000;
  // The county drained in one call: the reference every other way of getting there must match.
  const done = structuredClone(base);
  drain(done, to, Infinity);
  const reference = countyHash(done);

  it('the test economy actually moves (otherwise the checks below prove nothing)', () => {
    const c = structuredClone(done);
    expect(c.dayIndex).toBeGreaterThanOrEqual(2);
    for (const t of c.towns) {
      expect(population(t)).toBeGreaterThan(30);
      expect(t.money.reserves).not.toBe(base.towns[0].money.reserves);
    }
    expect(checkCounty(c)).toEqual([]);
    expect(c.towns.flatMap((t) => t.alerts)).toEqual([]);
  });

  // One unit (every tick its own chunk) and one that splits months and days unevenly; the real-engine
  // suite (determinism-real.test.ts) adds the server's 96 with a revive after every chunk.
  it.each([1, 13])('catch-up in chunks of %i equals one call', (budget) => {
    const c = structuredClone(base);
    const calls = drain(c, to, budget);
    if (budget < 50) expect(calls).toBeGreaterThan(10);
    expect(countyHash(c)).toBe(reference);
  });

  it('towns stepped in any order give the same county', () => {
    const c = structuredClone(base);
    // Before the first Regional Day, step the towns individually, last first, then finish normally.
    const g = gridTickAt(c, Math.min(to, nextRegionalDayAt(c)) - 1);
    for (const i of [2, 0, 1]) catchUpTown(c, i, g, TEST_STEPS);
    drain(c, to, 17);
    expect(countyHash(c)).toBe(reference);
  });

  it('revive-then-continue equals never-stored', () => {
    const c = structuredClone(base);
    drain(c, now + DAY + 7_200_000, 40);
    const revived = JSON.parse(JSON.stringify(c)) as CountyState;
    drain(revived, to, 40);
    expect(countyHash(revived)).toBe(reference);
  });

  it('JSON round-trips exactly and the state hash is stable', () => {
    const c = structuredClone(done);
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
    const t = c.towns[1];
    expect(stateHash(JSON.parse(JSON.stringify(t)))).toBe(stateHash(t));
    expect(stateHash(t)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('moves interleaved with catch-up land at the same tick whatever the chunking', () => {
    const run = (budget: number) => {
      const c = structuredClone(base);
      const mid = now + DAY / 3;
      drain(c, mid, budget);
      const res = applyCommand(c, 'ben', { type: 'build', planId: 'ben-2', plan: [{ op: 'zone', zone: 'shops', rect: [26, 26, 4, 1] }] }, mid + 1);
      drain(c, to, budget);
      return { h: countyHash(c), at: res.atTick };
    };
    const a = run(Infinity);
    const b = run(9);
    expect(b).toEqual(a);
  });

  it('the Regional Day is idempotent by dayIndex (A28)', () => {
    const c = structuredClone(done);
    const h = countyHash(c);
    expect(regionalDay(c, c.dayIndex - 1).ran).toBe(false);
    expect(countyHash(c)).toBe(h);
  });

  it('a non-finite now does nothing', () => {
    const c = structuredClone(base);
    const h = countyHash(c);
    expect(catchUp(c, NaN, 100)).toEqual({ used: 0, done: true, changed: false });
    expect(countyHash(c)).toBe(h);
  });
});

describe('the NaN guard and the blackboard (§10.4 item 9, A41)', () => {
  it('reverts a poisoned month, skips it with an alert, and leaves other towns alone', () => {
    const { c, now } = county(11);
    const clean = structuredClone(c);
    const poison = (t: TownState, m: MonthContext) => {
      testDemography(t, m);
      if (m.townIndex === 1 && t.tick === 27) t.people[0] = NaN;
    };
    const steps = withSteps({ develop: testDevelop, 'M9 demography': poison });
    catchUp(c, now + DAY, Infinity, { steps });
    catchUp(clean, now + DAY, Infinity, { steps: TEST_STEPS });
    expect(c.towns[1].alerts.map((a) => a.kind)).toEqual(['month-reverted']);
    expect(c.towns[1].alerts[0].message).toMatch(/people\[0\]|NaN/);
    expect(checkCounty(c)).toEqual([]);
    expect(stateHash(c.towns[0])).toBe(stateHash(clean.towns[0]));
    expect(stateHash(c.towns[2])).toBe(stateHash(clean.towns[2]));
    expect(c.towns[1].tick).toBe(clean.towns[1].tick);
  });

  it('refuses a step that writes a slot it did not declare, or replaces another step’s slot', () => {
    const { c, now } = county(12);
    const rogue = (_t: TownState, m: MonthContext) => {
      m.derived.labour = null;
      m.derived.firms = m.derived.firms ?? ({} as never);
    };
    catchUp(c, now + 3_600_000 * 3, Infinity, { steps: withSteps({ 'M9 demography': rogue }) });
    const msgs = c.towns[0].alerts.map((a) => a.message).join(' ');
    expect(msgs).toMatch(/M9 demography (replaced the labour slot|wrote the firms slot)/);
  });
});

describe('a broken tick never stops the county (§10.4 item 9)', () => {
  it('a tick step that throws is reverted and skipped with an alert; the county carries on', () => {
    const { c, now } = county(14);
    const clean = structuredClone(c);
    const throwing = (t: TownState, ctx: TickContext) => {
      testDevelop(t, ctx);
      if (ctx.townIndex === 1 && t.tick === 30) throw new Error('boom');
    };
    const steps = withSteps({ develop: throwing, 'M9 demography': testDemography });
    expect(() => catchUp(c, now + DAY, Infinity, { steps })).not.toThrow();
    catchUp(clean, now + DAY, Infinity, { steps: TEST_STEPS });
    expect(c.towns[1].alerts.map((a) => a.kind)).toEqual(['tick-reverted']);
    expect(c.towns[1].alerts[0].message).toMatch(/tick 30 skipped: boom/);
    expect(c.towns[1].tick).toBe(clean.towns[1].tick);
    expect(stateHash(c.towns[0])).toBe(stateHash(clean.towns[0]));
    expect(checkCounty(c)).toEqual([]);
  });

  it('a NaN written by a tick step is caught at that tick, not laundered into 0 by the month revert', () => {
    const { c, now } = county(15);
    const poison = (t: TownState, ctx: TickContext) => {
      testDevelop(t, ctx);
      if (ctx.townIndex === 0 && t.tick === 29) t.money.reserves = NaN;
    };
    catchUp(c, now + DAY, Infinity, { steps: withSteps({ develop: poison, 'M9 demography': testDemography }) });
    const t = c.towns[0];
    expect(t.alerts.map((a) => a.kind)).toEqual(['tick-reverted']);
    expect(t.alerts[0].message).toMatch(/reserves = NaN/);
    expect(Number.isInteger(t.money.reserves)).toBe(true);
    expect(t.money.reserves).toBeGreaterThan(50_000);
    expect(checkCounty(c)).toEqual([]);
  });
});

describe('the clock under moves (A19, A21, §2.4)', () => {
  /** Two towns, sprinted, then left alone. */
  function quiet(seed: number): { c: CountyState; now: number } {
    const c = newCounty(seed);
    let now = c.epoch + 60_000;
    for (const [s, site] of [['a', 0], ['b', 2]] as const) now = foundAndSprint(c, s, site, now).now + 1000;
    c.parents.push('a');
    return { c, now };
  }
  const opts = { steps: TEST_STEPS };

  it('waking a nap gives the same county however far catch-up had got, and whether or not the nap was recorded', () => {
    const { c: c0, now } = quiet(4);
    const wakeAt = now + 4 * DAY;
    const run = (budget: number, recordNap: boolean) => {
      const c = structuredClone(c0);
      catchUp(c, wakeAt, budget, opts);
      if (recordNap) napCheck(c, wakeAt, 72 * 3_600_000);
      applyCommand(c, 'a', { type: 'hello' }, wakeAt, opts);
      drain(c, wakeAt + DAY, Infinity);
      return { day: c.dayIndex, ticks: c.towns.map((t) => t.tick), h: countyHash(c) };
    };
    const ref = run(Infinity, true);
    expect(run(96, true)).toEqual(ref);
    expect(run(Infinity, false)).toEqual(ref);
    // The nap really froze the county: 4 days away and 1 day on, but only the days before the nap ran.
    expect(ref.day).toBeLessThan(5);
  });

  it('ending a pause gives the same county (and the same tick instants) however far catch-up had got', () => {
    const { c: c0, now } = quiet(5);
    const R = nextRegionalDayAt(c0);
    drain(c0, R + 60_000, Infinity);
    const pauseAt = R + 20 * 3_600_000;
    const run = (budget: number) => {
      const c = structuredClone(c0);
      applyCommand(c, 'a', { type: 'pause', on: true, moveId: 'p1' }, pauseAt, opts);
      catchUp(c, pauseAt + DAY, budget, opts);
      applyCommand(c, 'a', { type: 'pause', on: false, moveId: 'p2' }, pauseAt + DAY, opts);
      drain(c, pauseAt + 3 * DAY, Infinity);
      return { day: c.dayIndex, ticks: c.towns.map((t) => t.tick), h: countyHash(c) };
    };
    const ref = run(Infinity);
    expect(run(0)).toEqual(ref);
    expect(run(9)).toEqual(ref);
  });

  it('a move during "Play it all" lands after the auto sprint ticks already due, whatever ran before it', () => {
    const c0 = newCounty(6);
    const now = nextRegionalDayAt(c0) + 3_600_000;
    drain(c0, now, Infinity);
    applyCommand(c0, 'a', { type: 'found', site: 0, nameParts: ['Oak', 'vale'], avatar: 'badger', flag: 0 }, now, opts);
    applyCommand(c0, 'a', { type: 'sprint', moveId: 'auto', auto: true }, now + 1000, opts);
    const moveAt = now + 1000 + 5 * 15_000 + 500;
    const run = (budget: number) => {
      const c = structuredClone(c0);
      if (budget) catchUp(c, moveAt, budget, opts);
      const r = applyCommand(c, 'a', { type: 'build', planId: 'p1', plan: [{ op: 'zone', zone: 'homes', rect: [26, 29, 6, 4] }, { op: 'road', kind: 'lane', path: [32, 43, 32, 28, 22, 28] }] }, moveAt, opts);
      drain(c, moveAt + DAY, Infinity);
      return { at: r.atTick, h: countyHash(c) };
    };
    const ref = run(Infinity);
    expect(ref.at).toBe(5);
    expect(run(2)).toEqual(ref);
    expect(run(0)).toEqual(ref);
  });

  it('a refused founding changes nothing, even while the county sleeps', () => {
    const { c, now } = quiet(7);
    const at = now + 5 * DAY;
    const h = countyHash(c);
    expect(() => applyCommand(c, 'z', { type: 'found', site: 0, nameParts: ['Oak', 'vale'], avatar: 'badger', flag: 0 }, at, opts)).toThrow(/already built/);
    expect(countyHash(c)).toBe(h);
    expect(c.nap).toBeNull();
    expect(c.lastHelloAt).toBeLessThan(at);
  });
});

describe('invariants after a long run', () => {
  it('books balance to the pound and people are conserved', () => {
    const { c, now } = county(13);
    catchUp(c, now + 5 * DAY, Infinity, { steps: TEST_STEPS });
    for (const t of c.towns) {
      const posted = t.books.lines.reduce((a, b) => a + b, 0);
      expect(t.books.open + posted).toBe(t.money.reserves);
      expect(t.books.popOpen + t.books.pop.reduce((a, b) => a + b, 0)).toBe(population(t));
      expect(Number.isInteger(t.money.reserves)).toBe(true);
      for (const v of Object.values(t.carry)) expect(Math.abs(v)).toBeLessThan(CARRY_SCALE);
    }
    expect(checkCounty(c)).toEqual([]);
  });
});
