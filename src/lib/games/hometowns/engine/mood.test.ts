// Mood and the month's records (spec §5.15, M14): happiness follows U_happy
// with τ 3, Mood is the population-weighted mean, Approval follows Mood, the
// checklist and the homes tax (A13), Town Talk is a poll whose percentages
// sum to 100, and the wants bubbles, history and money Why are written.

import { describe, expect, it } from 'vitest';
import { civicSteps, type CivicScript } from '../../../../../scripts/hometowns/civic-kit';
import { fixture } from '../../../../../scripts/hometowns/fixture';
import { runMonths } from '../../../../../scripts/hometowns/people-kit';
import { population } from './core';
import { moodFace, townTalk } from './mood';
import { paramsFor } from './params';
import { readHistory } from './records';
import { COHORT_COUNT, STARS, STAR_COUNT, person, starTier, type TownState } from './types';
import { readWhy } from './why';

const P = paramsFor('v1');

function town(people?: (t: TownState) => void) {
  const f = fixture('town');
  const t = f.county.towns[f.town];
  if (people) {
    people(t);
    t.books.popOpen = population(t);
  }
  t.orders = [];
  return { c: f.county, i: f.town, t };
}

const stars = (v: number, over: Record<number, number> = {}) => {
  const a = new Array<number>(STAR_COUNT).fill(v);
  for (const [k, x] of Object.entries(over)) a[+k] = x;
  return a;
};
const S = (k: (typeof STARS)[number]) => STARS.indexOf(k);
const RICH: CivicScript = { housing: { rent: [300, 450, 800], occ: [1000, 2000, 500] }, firms: { turnover: 10_000_000 } };

describe('happiness and Mood', () => {
  it('moves a third of the way to 50 + 14·U_happy each month, and Mood weights cohorts by people', () => {
    const { c, i, t } = town();
    const u = Array.from({ length: COHORT_COUNT }, (_, k) => (k % 3) - 1); // −1, 0, +1 …
    t.happy.fill(60);
    const [d] = runMonths(c, i, 1, civicSteps({ ...RICH, stars: { actual: stars(50), uHappy: u } }));
    for (let k = 0; k < COHORT_COUNT; k++) expect(t.happy[k]).toBeCloseTo(60 + (50 + 14 * u[k] - 60) / 3, 9);
    const n = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let h = 0; h < 3; h++) {
      n[h * 3] = t.people[person(0, h)];
      n[h * 3 + 1] = t.people[person(1, h)] + t.people[person(2, h)];
      n[h * 3 + 2] = t.people[person(3, h)];
    }
    n[9] = t.people[12];
    let want = 0;
    for (let k = 0; k < COHORT_COUNT; k++) want += n[k] * t.happy[k];
    expect(d.mood!.mood).toBeCloseTo(want / population(t), 9);
  });

  it('stays within 0–100 however extreme U_happy is', () => {
    const { c, i, t } = town();
    runMonths(c, i, 12, civicSteps({ ...RICH, stars: { actual: stars(50), uHappy: new Array(COHORT_COUNT).fill(40) } }));
    expect(t.happy.every((x) => x <= 100 && x > 99)).toBe(true);
    runMonths(c, i, 12, civicSteps({ ...RICH, stars: { actual: stars(50), uHappy: new Array(COHORT_COUNT).fill(-40) } }));
    expect(t.happy.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('shows five faces at the §5.15 thresholds', () => {
    const f = P.civic.faces;
    expect([0, 29.9, 30, 44, 45, 64, 65, 79, 80, 100].map((x) => moodFace(x, f))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe('Approval (§5.15, A13)', () => {
  it('follows 0.70·Mood + 0.25·(100 − 10·#unmet) − 1.5·max(0, HomesTax% − 10) with τ 6', () => {
    const { c, i, t } = town();
    t.taxes.homes = [1400, 1400, 1400];
    const before = t.approval;
    const [d] = runMonths(c, i, 1, civicSteps({ ...RICH, stars: { actual: stars(50), uHappy: new Array(COHORT_COUNT).fill(0.5) } }));
    const rec = readWhy(t).monthly.at(-1)!;
    const e = rec.entries.find((x) => x.q === 'approval')!;
    const term = (k: string) => e.terms.find(([key]) => key === k)?.[1] ?? 0;
    expect(term('approval.mood')).toBeCloseTo(0.7 * d.mood!.mood, 1);
    expect(term('approval.tax')).toBeCloseTo(-1.5 * 4, 6);
    const unmet = (100 - term('approval.checklist') / 0.25) / 10;
    expect(Math.abs(unmet - Math.round(unmet))).toBeLessThan(1e-3);
    const target = term('approval.mood') + term('approval.checklist') + term('approval.tax');
    expect(t.approval).toBeCloseTo(before + (target - before) / 6, 1);
    expect(e.v).toBeCloseTo(t.approval, 1);
  });

  it('a homes tax at 16% costs approval that 10% does not (the land-limited brake)', () => {
    const run = (bp: number) => {
      const { c, i, t } = town();
      t.taxes.homes = [bp, bp, bp];
      runMonths(c, i, 24, civicSteps({ ...RICH, stars: { actual: stars(60), uHappy: new Array(COHORT_COUNT).fill(0.5) } }));
      return t.approval;
    };
    expect(run(1000) - run(1600)).toBeCloseTo(1.5 * 6, 0);
  });
});

describe('Town Talk', () => {
  /** Only £ Workers, so the severities can be worked by hand. */
  const workers = (n: number) => (t: TownState) => {
    t.people.fill(0);
    t.people[person(0, 0)] = n;
  };

  it('counts each cohort that cares about a star below 55, in proportion to the gap', () => {
    const { c, i } = town(workers(1000));
    const actual = stars(100, { [starTier(0, 0)]: 0, [S('fun')]: 35 });
    const [d] = runMonths(c, i, 1, civicSteps({ ...RICH, stars: { actual, uHappy: new Array(COHORT_COUNT).fill(0) } }));
    // Jobs: 1000 · 1.8 · 55/55 = 1800; Fun: 1000 · 0.6 · 20/55 ≈ 218.2.
    const jobs = 1800;
    const fun = (1000 * 0.6 * 20) / 55;
    expect(d.mood!.townTalk).toEqual([
      ['jobs', Math.round((100 * jobs) / (jobs + fun))],
      ['fun', 100 - Math.round((100 * jobs) / (jobs + fun))],
    ]);
  });

  it('talks about tax above 8% and about traffic', () => {
    const { c, i, t } = town(workers(1000));
    t.taxes.homes = [1800, 1800, 1800];
    const [d] = runMonths(c, i, 1, civicSteps({ ...RICH, travel: { congestion: 0.2 }, stars: { actual: stars(100), uHappy: new Array(COHORT_COUNT).fill(0) } }));
    // Tax: (18 − 8) · 1000 · 0.1 = 1000 against Traffic 0.2 · 1000 = 200.
    expect(d.mood!.townTalk).toEqual([
      ['tax', 83],
      ['traffic', 17],
    ]);
  });

  it('shows the top four, as whole percentages that sum to exactly 100', () => {
    for (let seed = 1; seed < 200; seed++) {
      const sev = Array.from({ length: 12 }, (_, k) => ((seed * 7919 + k * 104729) % 997) / ((k % 5) + 1));
      if (seed % 3 === 0) sev[seed % 12] = 0;
      const talk = townTalk([...STARS, 'traffic'], sev, 4);
      expect(talk).toHaveLength(4);
      expect(talk.reduce((a, [, p]) => a + p, 0)).toBe(100);
      for (let j = 1; j < talk.length; j++) expect(talk[j - 1][1]).toBeGreaterThanOrEqual(talk[j][1]);
    }
    expect(townTalk(['a', 'b'], [0, 0], 4)).toEqual([]);
    expect(townTalk(['a', 'b', 'c'], [1, 1, 1], 4)).toEqual([['a', 34], ['b', 33], ['c', 33]]);
  });
});

describe('wants, history and the money Why', () => {
  it('raises at most three wants bubbles, ranked by severity × group size', () => {
    const { c, i, t } = town();
    t.meters[0] = 90;
    t.meters[3] = 50;
    const [d] = runMonths(c, i, 1, civicSteps({ ...RICH, utilities: { poweredShare: 0.5 }, stars: { actual: stars(30), uHappy: new Array(COHORT_COUNT).fill(0) } }));
    const w = d.mood!.wants;
    expect(w.length).toBe(3);
    for (let j = 1; j < w.length; j++) expect(w[j - 1].severity).toBeGreaterThanOrEqual(w[j].severity);
    expect(w.map((x) => x.key)).toContain('power');
    expect(t.civicMemo!.wants).toEqual(w);
  });

  it('records the month: history series and every ledger line as a Why term of revenue or spending', () => {
    const { c, i, t } = town();
    const [d] = runMonths(c, i, 1, civicSteps(RICH));
    expect(readHistory(t, 'mood').at(-1)).toBeCloseTo(d.mood!.mood, 1);
    expect(readHistory(t, 'approval').at(-1)).toBeCloseTo(t.approval, 1);
    expect(readHistory(t, 'revenue').at(-1)).toBe(Math.round(t.civicMemo!.revenue));
    const rec = readWhy(t).monthly.at(-1)!;
    const rev = rec.entries.find((e) => e.q === 'revenue')!;
    expect(rev.terms[0][0]).toBe('money.businessTax');
    const spend = rec.entries.find((e) => e.q === 'spending')!;
    expect(spend.v).toBeLessThan(0);
    expect(t.alerts).toEqual([]); // no unknown Why keys
  });
});
