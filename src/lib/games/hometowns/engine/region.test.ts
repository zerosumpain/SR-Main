// WP3 migration between players (spec §8.4, A31, A34): every cap in
// isolation and in combination, conservation of people, order independence
// (any relabelling of the towns gives the same flows, relabelled), the shield
// trigger, and MoveStories. Numbers are chosen to show each rule; no test
// asserts a balance figure the tuning could move.

import { describe, expect, it } from 'vitest';
import { multiCounty, linkAll, nextContext, totalPeople } from '../../../../../scripts/hometowns/region-kit';
import { houseMovers, settleMigration, stepPlayerMigration, type MigTown, type MigrationRules } from './region';
import { regionOf } from './region-state';
import { storyFor } from './stories';
import { STARS, starTier, type CountyState } from './types';

const K = 10;
const RULES: MigrationRules = { pairCap: 0.01, weeklyCap: 0.04, housingShare: 0.5 };

function town(over: Partial<MigTown> = {}): MigTown {
  return {
    pop: 10_000,
    active: true,
    holiday: false,
    grace: false,
    shield: false,
    floor: false,
    weekStartPop: 10_000,
    lossPrev: 0,
    awayRoom: Infinity,
    cohorts: [2000, 2000, 500, 1500, 1500, 500, 800, 800, 300, 100],
    vacant: [5000, 5000, 5000],
    ...over,
  };
}

/** Intents at (i·n + j)·10 + k. */
function intents(n: number, list: [i: number, j: number, k: number, x: number][]): number[] {
  const a = new Array<number>(n * n * K).fill(0);
  for (const [i, j, k, x] of list) a[(i * n + j) * K + k] += x;
  return a;
}

const moved = (r: { moved: number[] }, n: number, i: number, j: number) => {
  let s = 0;
  for (let k = 0; k < K; k++) s += r.moved[(i * n + j) * K + k];
  return s;
};
const out = (r: { moved: number[] }, n: number, i: number) => {
  let s = 0;
  for (let j = 0; j < n; j++) if (j !== i) s += moved(r, n, i, j);
  return s;
};

describe('settleMigration: netting and each cap in isolation', () => {
  it('nets intents per pair and cohort: only the difference moves', () => {
    const r = settleMigration([town(), town()], intents(2, [[0, 1, 0, 30], [1, 0, 0, 12], [1, 0, 4, 9]]), RULES);
    expect(r.moved[(0 * 2 + 1) * K + 0]).toBe(18);
    expect(r.moved[(1 * 2 + 0) * K + 0]).toBe(0);
    expect(r.moved[(1 * 2 + 0) * K + 4]).toBe(9);
  });

  it('freeze: nothing leaves a town on holiday or in grace, and nothing enters a town on holiday (A31)', () => {
    const I = intents(2, [[0, 1, 0, 50], [1, 0, 3, 40]]);
    const base = settleMigration([town(), town()], I, RULES);
    expect(out(base, 2, 0)).toBe(50);
    expect(out(base, 2, 1)).toBe(40);
    // Holiday freezes BOTH directions.
    const hol = settleMigration([town({ holiday: true }), town()], I, RULES);
    expect(out(hol, 2, 0)).toBe(0);
    expect(out(hol, 2, 1)).toBe(0);
    // Grace freezes outbound only.
    const grace = settleMigration([town({ grace: true }), town()], I, RULES);
    expect(out(grace, 2, 0)).toBe(0);
    expect(out(grace, 2, 1)).toBe(40);
    // A town not on the grid (fortnight) or archived takes no part.
    const off = settleMigration([town({ active: false }), town()], I, RULES);
    expect(out(off, 2, 0) + out(off, 2, 1)).toBe(0);
  });

  it('shield: Community Spirit halves outbound flows', () => {
    const r = settleMigration([town({ shield: true }), town()], intents(2, [[0, 1, 0, 60]]), RULES);
    expect(out(r, 2, 0)).toBe(30);
  });

  it('pair cap: net i→j at most pairCap·N_i a day', () => {
    const r = settleMigration([town({ pop: 5000 }), town()], intents(2, [[0, 1, 0, 400], [0, 1, 3, 100]]), RULES);
    expect(moved(r, 2, 0, 1)).toBeLessThanOrEqual(0.01 * 5000);
    expect(moved(r, 2, 0, 1)).toBe(50);
    // Pro rata across cohorts: 4:1.
    expect(r.moved[(0 * 2 + 1) * K + 0]).toBe(40);
    expect(r.moved[(0 * 2 + 1) * K + 3]).toBe(10);
  });

  it('weekly cap: the rolling week’s net loss to players at most weeklyCap·N(week start)', () => {
    const T = [town({ weekStartPop: 10_000, lossPrev: 380 }), town(), town()];
    const r = settleMigration(T, intents(3, [[0, 1, 0, 80], [0, 2, 0, 80]]), RULES);
    // 4% of 10,000 = 400, of which 380 already went this week.
    expect(out(r, 3, 0)).toBeLessThanOrEqual(20);
    expect(out(r, 3, 0)).toBeGreaterThanOrEqual(19);
    // Spread pro rata over destinations.
    expect(Math.abs(moved(r, 3, 0, 1) - moved(r, 3, 0, 2))).toBeLessThanOrEqual(1);
  });

  it('median floor: a town below the median that is improving loses nobody to players', () => {
    const r = settleMigration([town({ floor: true }), town()], intents(2, [[0, 1, 0, 50], [1, 0, 3, 20]]), RULES);
    expect(out(r, 2, 0)).toBe(0);
    // It can still gain.
    expect(out(r, 2, 1)).toBe(20);
  });

  it('housing: movers need a vacancy of their tier, at most half the vacancies a day; Families and Retirees may go one tier down', () => {
    // Destination has 40 £ homes free and none above: 20 a day.
    const dest = town({ vacant: [40, 0, 0] });
    const r = settleMigration([town(), dest], intents(2, [[0, 1, 0, 30], [0, 1, 3, 30]]), RULES);
    // ££ Workers (k 3) cannot go down a tier; £ Workers take the 20 places.
    expect(r.moved[(0 * 2 + 1) * K + 3]).toBe(0);
    expect(r.moved[(0 * 2 + 1) * K + 0]).toBe(20);
    // ££ Families (k 4) may take a £ home.
    const fam = settleMigration([town(), town({ vacant: [40, 0, 0] })], intents(2, [[0, 1, 4, 30]]), RULES);
    expect(fam.moved[(0 * 2 + 1) * K + 4]).toBe(20);
  });

  it('the Away cap applies on top (A34)', () => {
    const r = settleMigration([town({ awayRoom: 7 }), town()], intents(2, [[0, 1, 0, 50]]), RULES);
    expect(out(r, 2, 0)).toBe(7);
  });
});

describe('settleMigration: caps in combination, conservation and order', () => {
  it('applies every cap in order and never exceeds any of them', () => {
    const T = [
      town({ pop: 8000, shield: true, weekStartPop: 8000, lossPrev: 250, awayRoom: 25 }),
      town({ pop: 12_000, vacant: [30, 10, 0] }),
      town({ pop: 9000, vacant: [100, 100, 100] }),
    ];
    const I = intents(3, [[0, 1, 0, 200], [0, 1, 4, 200], [0, 2, 1, 200], [1, 0, 0, 20], [2, 1, 6, 300]]);
    const r = settleMigration(T, I, RULES);
    // Each stage only ever lowers the flow.
    for (let s = 1; s < r.stages.length; s++) expect(r.stages[s]).toBeLessThanOrEqual(r.stages[s - 1] + 1e-9);
    expect(out(r, 3, 0)).toBeLessThanOrEqual(25); // the Away cap
    for (let j = 1; j < 3; j++) expect(moved(r, 3, 0, j)).toBeLessThanOrEqual(0.01 * 8000);
    expect(out(r, 3, 0)).toBeLessThanOrEqual(0.04 * 8000 - 250);
    // Destination 1's housing: half its vacancies at most.
    let into1 = 0;
    for (const i of [0, 2]) into1 += moved(r, 3, i, 1);
    expect(into1).toBeLessThanOrEqual(15 + 5);
    // Whole persons only, never negative.
    for (const x of r.moved) expect(Number.isInteger(x) && x >= 0).toBe(true);
  });

  it('a cohort never sends more people than it has', () => {
    const T = [town({ cohorts: [3, 0, 0, 0, 0, 0, 0, 0, 0, 0] }), town(), town()];
    const r = settleMigration(T, intents(3, [[0, 1, 0, 50], [0, 2, 0, 50]]), { ...RULES, pairCap: 1, weeklyCap: 1 });
    expect(out(r, 3, 0)).toBeLessThanOrEqual(3);
  });

  it('gives the same flows, relabelled, for any order of the towns', () => {
    const T = [town({ pop: 9000 }), town({ pop: 14_000, vacant: [80, 30, 5] }), town({ pop: 6000, shield: true }), town({ pop: 11_000, floor: true })];
    const list: [number, number, number, number][] = [[0, 1, 0, 70.3], [0, 2, 4, 33.1], [2, 1, 3, 55.7], [1, 0, 1, 12.9], [3, 0, 0, 40], [2, 3, 7, 21.4], [0, 3, 8, 9.6]];
    const n = 4;
    const ref = settleMigration(T, intents(n, list), RULES);
    for (const perm of [[1, 0, 2, 3], [3, 2, 1, 0], [2, 3, 0, 1], [1, 3, 0, 2]]) {
      // Town i becomes perm[i].
      const T2: MigTown[] = new Array(n);
      T.forEach((t, i) => (T2[perm[i]] = t));
      const r = settleMigration(T2, intents(n, list.map(([i, j, k, x]) => [perm[i], perm[j], k, x])), RULES);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < K; k++) expect(r.moved[(perm[i] * n + perm[j]) * K + k]).toBe(ref.moved[(i * n + j) * K + k]);
    }
  });
});

describe('houseMovers', () => {
  it('shares a tier pro rata between the cohorts that want it', () => {
    const got = houseMovers([30, 0, 0, 0, 0, 0, 0, 0, 0, 10], [20, 0, 0], 1);
    expect(got[0] + got[9]).toBe(20);
    expect(got[0]).toBe(15);
  });
  it('lets Students take ££ homes after £', () => {
    const got = houseMovers([0, 0, 0, 0, 0, 0, 0, 0, 0, 10], [0, 20, 0], 1);
    expect(got[9]).toBe(10);
  });
});

// ---- The county step --------------------------------------------------------------------------------

function withIntents(c: CountyState, list: [i: number, j: number, k: number, x: number][]): void {
  const n = c.towns.length;
  for (const [i, j, k, x] of list) {
    const t = c.towns[i];
    const acc = t.realised.intents ?? new Array<number>(n * K).fill(0);
    acc[j * K + k] += x;
    t.realised.intents = acc;
    c.ledger[(i * n + j) * K + k] += x;
  }
}

describe('stepPlayerMigration (the county step)', () => {
  it('conserves people across the county, and books every move as playersOut/playersIn', () => {
    const { c } = multiCounty(3, 'town');
    linkAll(c);
    const before = totalPeople(c);
    withIntents(c, [[0, 1, 0, 25], [0, 2, 1, 30], [1, 2, 4, 22], [2, 0, 3, 18]]);
    const r = nextContext(c);
    stepPlayerMigration(c, r);
    expect(totalPeople(c)).toBe(before);
    let outs = 0;
    let ins = 0;
    for (const t of c.towns) {
      outs += t.books.dayPop[5];
      ins += t.books.dayPop[4];
    }
    expect(outs).toBeLessThan(0);
    expect(ins).toBe(-outs);
    // Leftover intents vanish.
    expect(c.ledger.every((x) => x === 0)).toBe(true);
  });

  it('gives Community Spirit to a town that lost more than 3% to players over 7 days', () => {
    const { c } = multiCounty(2, 'town');
    linkAll(c);
    const g = regionOf(c);
    const t = c.towns[0];
    const pop = t.people.reduce((a, b) => a + b, 0);
    g.popDays[0] = [pop, pop, pop, pop, pop, pop];
    g.lossDays[0] = [0, 0, 0, 0, 0, Math.ceil(0.031 * pop)];
    const r = nextContext(c);
    stepPlayerMigration(c, r);
    expect(t.shield).toBe(r.dayIndex + 1 + 7);
    expect(t.inbox.some((x) => x.kind === 'communitySpirit')).toBe(true);
    // Below the threshold: no shield.
    const { c: c2 } = multiCounty(2, 'town');
    const g2 = regionOf(c2);
    g2.popDays[0] = [pop, pop, pop, pop, pop, pop];
    g2.lossDays[0] = [0, 0, 0, 0, 0, Math.floor(0.029 * pop)];
    stepPlayerMigration(c2, nextContext(c2));
    expect(c2.towns[0].shield).toBeNull();
  });
});

describe('MoveStories', () => {
  it('name the top 2 reasons and a counter-move for the town that lost people', () => {
    const { c } = multiCounty(2, 'town');
    const [a, b] = c.towns;
    a.perceived.fill(50);
    b.perceived.fill(50);
    const S = (k: string) => STARS.indexOf(k as (typeof STARS)[number]);
    // ££ Families (k 4) weigh Schools 1.6 and Safety 1.2: the winner is better at both.
    b.perceived[S('schools')] = 90;
    b.perceived[S('safety')] = 80;
    // The loser's homes are cheaper (the ££ Homes star).
    a.perceived[starTier(1, 1)] = 85;
    b.perceived[starTier(1, 1)] = 40;
    const s = storyFor(c, 3, 0, 1, 4, 120);
    expect(s.reasons).toEqual(['schools', 'safety']);
    expect(s.gaps[0]).toBeGreaterThan(s.gaps[1]);
    expect(s.strength).toBe('homes');
    expect(s.action).toBe('advert');
    expect(s).toMatchObject({ from: 0, to: 1, cohort: 4, n: 120, day: 3 });
  });
});
