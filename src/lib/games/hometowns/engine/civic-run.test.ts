// WP2d's acceptance runs.
//   - The ledger balances to the pound every month for 600 months (50 days)
//     of a stormy scripted economy with booms, busts, Helper Mode episodes
//     and a mayor who keeps borrowing, repaying and switching cards, and the
//     carries lose less than a pound of any line over the whole run.
//   - A14: a City-tier town at default taxes with full City services is not
//     structurally in deficit, with every landed package live, even with
//     civicUpkeepScale at the top of the Lab's range.
//   - The tier check runs inside a real Regional Day.

import { describe, expect, it } from 'vitest';
import { CITY_SERVICES, cityTown, civicSteps, liveSteps, type CivicScript } from '../../../../../scripts/hometowns/civic-kit';
import { fixture } from '../../../../../scripts/hometowns/fixture';
import { runMonths } from '../../../../../scripts/hometowns/people-kit';
import { nextRegionalDayAt } from './clock';
import { applyCommand } from './commands';
import { catchUp } from './county';
import { lineIndex, population, postPeople } from './core';
import { stepFinance } from './finance';
import { checkTown } from './invariants';
import { paramsFor, type Params } from './params';
import { withSteps } from './steps';
import { COVERAGES, EngineError, person, type Command, type MonthContext, type StepTable, type TownState } from './types';

const P = paramsFor('v1');

/** A deterministic pseudo-random number in [0, 1) for (a, b). */
const rnd = (a: number, b: number) => (((a * 2654435761 + b * 40503 + 12345) >>> 0) % 100003) / 100003;

describe('the ledger over 600 months', () => {
  it('balances to the pound every month, and every carry stays under a pound', () => {
    const f = fixture('town');
    const c = f.county;
    const t = c.towns[f.town];
    t.tier = 3; // bonds too
    t.initiatives = 50;
    const open = t.money.reserves;
    let exactHomes = 0;
    let postedHomes = 0;
    let month = 0;
    let lastTick = -1;
    const script = (tt: TownState): CivicScript => {
      // Booms and busts: a slow swing, noise, and an occasional crash in the utility bill.
      const k = month;
      const bust = rnd(Math.floor(k / 30), 0) < 0.35;
      const swing = bust ? 0.05 * rnd(k, 2) : 0.6 + 0.5 * rnd(Math.floor(k / 30), 1) + 0.2 * rnd(k, 2);
      const crash = rnd(k, 3) < 0.05 ? 10_000_000 * (0.5 + rnd(k, 4)) : 0;
      const rent = [250 + 100 * rnd(k, 5), 400 + 100 * rnd(k, 6), 700 + 300 * rnd(k, 7)];
      const occ = [3000 + Math.floor(2000 * rnd(k, 8)), 4000, 1200];
      // Every scripted step asks; count the month's exact homes tax once (taxes move only in M13).
      if (tt.tick !== lastTick) for (let h = 0; h < 3; h++) exactHomes += (tt.taxes.homes[h] / 10000) * rent[h] * occ[h];
      lastTick = tt.tick;
      return {
        housing: { rent, occ },
        firms: { turnover: 9_000_000 * swing },
        spend: { turnover: 3_000_000 * swing },
        tourism: { hotelNights: 2000 * rnd(k, 9) },
        travel: { busShare: 0.15 * rnd(k, 10), railShare: 0.05 * rnd(k, 11) },
        labour: { employed: [3000, 3000, 1000] },
        utilities: { importCost: 50_000 + crash, exportIncome: 5_000 * rnd(k, 12) },
      };
    };
    const steps = civicSteps(script);
    let posted = 0;
    let longestHelper = 0;
    let helperMonths = 0;
    let moves = 0;
    const cards = ['litterPickers', 'nightMarket', 'treePlanting', 'cleanAirRules', 'freeBusFridays'];
    const tryMove = (cmd: Command) => {
      try {
        applyCommand(c, t.seat, cmd, f.now);
        moves++;
      } catch (e) {
        if (!(e instanceof EngineError)) throw e;
      }
    };
    for (; month < 600; month++) {
      if (month % 7 === 3) {
        // The mayor fiddles: a loan, a repayment, a bond, a card, the taxes.
        const r = rnd(month, 20);
        const id = `m${month}`;
        if (r < 0.2) tryMove({ type: 'loan', moveId: id, take: 200_000 + Math.floor(800_000 * rnd(month, 21)) });
        else if (r < 0.35) tryMove({ type: 'loan', moveId: id, repay: 100_000 });
        else if (r < 0.5) tryMove({ type: 'bond', moveId: id, issue: { size: 3, years: 10 } });
        else if (r < 0.6 && t.money.bonds.length) tryMove({ type: 'bond', moveId: id, repay: { id: t.money.bonds[0].id } });
        else if (r < 0.8) tryMove({ type: 'policy', moveId: id, card: cards[Math.floor(5 * rnd(month, 22))], on: rnd(month, 23) < 0.6 });
        else tryMove({ type: 'budget', moveId: id, taxes: { homes: [600, 800, 1000, 1200, 1400][Math.floor(5 * rnd(month, 24))] } });
      }
      const [d] = runMonths(c, f.town, 1, steps);
      expect(checkTown(t), `month ${month}`).toEqual([]);
      expect(t.alerts, `month ${month}`).toEqual([]);
      for (const x of d.ledger!.lines) posted += x;
      postedHomes += d.ledger!.lines[lineIndex('homesTax')];
      if (t.money.helper) {
        helperMonths++;
        longestHelper = Math.max(longestHelper, c.dayIndex - t.money.helper.sinceDay);
      }
      if ((month + 1) % 12 === 0) c.dayIndex += 1;
    }
    // Every pound is on a line: reserves are the opening balance plus all 600 months' postings.
    expect(t.money.reserves).toBe(open + posted);
    // The carries lose less than a pound of homes tax over 600 months.
    expect(postedHomes).toBeGreaterThan(1e8);
    expect(Math.abs(exactHomes - postedHomes)).toBeLessThan(1);
    // The storm really tested it: Helper Mode came and went, and the mayor's moves landed.
    expect(helperMonths).toBeGreaterThan(0);
    expect(longestHelper).toBeLessThanOrEqual(P.finance.helperWriteOffDays);
    expect(moves).toBeGreaterThan(25);
  });
});

// ---- A14: Cities are not structurally in deficit -----------------------------------------------------------

/** The live engine with finance read through other params (civicUpkeepScale for the Lab's range). */
function scaledSteps(p: Params): StepTable {
  const base = liveSteps();
  return withSteps({
    develop: base.tick.find((r) => r.id === 'develop')!.run,
    'M1b supply': base.month.find((r) => r.id === 'M1b supply')!.run,
    'M13 finance': (t: TownState, m: MonthContext) => stepFinance(t, { ...m, params: p }),
  });
}

function cityBooks(services: readonly string[], p: Params = P): { revenue: number; spending: number; pop: number } {
  const k = cityTown({ services });
  let revenue = 0;
  let spending = 0;
  let n = 0;
  runMonths(k.c, k.i, 36, p === P ? liveSteps() : scaledSteps(p), (month, d) => {
    expect(k.t.alerts).toEqual([]);
    if (month < 12) return; // let the town settle for a year
    revenue += d.ledger!.revenue;
    spending += d.ledger!.spending;
    n++;
  });
  return { revenue: revenue / n, spending: spending / n, pop: population(k.t) };
}

describe('A14: a City at default taxes with full services pays its way', () => {
  it('runs a surplus with the City service set', () => {
    const b = cityBooks(CITY_SERVICES);
    expect(b.pop).toBeGreaterThan(15_000);
    expect(b.revenue).toBeGreaterThan(b.spending);
  });

  it('still does with a Hospital and a University on top', () => {
    const b = cityBooks([...CITY_SERVICES, 'hospital', 'university']);
    expect(b.revenue).toBeGreaterThan(b.spending);
  });

  it('still does at the top of the Lab’s civicUpkeepScale range', () => {
    const scale = paramsFor('v1');
    const top = { ...scale, finance: { ...scale.finance, civicUpkeepScale: 1.5 } } as Params;
    const b = cityBooks(CITY_SERVICES, top);
    expect(b.revenue).toBeGreaterThan(b.spending);
  });
});

// ---- The tier check inside a real Regional Day --------------------------------------------------------------

describe('promotion through the county drive', () => {
  it('promotes a Hamlet that holds the Village checklist at two Regional Days', () => {
    const f = fixture('hamlet');
    const c = f.county;
    const t = c.towns[f.town];
    postPeople(t, 'arrivals', person(0, 0), 330 - population(t));
    t.books.popOpen = population(t);
    t.books.pop.fill(0);
    t.approval = 80;
    const full = () => new Float64Array(1024).fill(100);
    const steps = civicSteps({
      development: { built: [40, 8, 0, 0, 0, 0] },
      coverage: { cov: COVERAGES.map(full) },
      stars: { uHappy: new Array(10).fill(2) },
    });
    let now = f.now;
    for (let d = 0; d < 3 && t.tier === 0; d++) {
      now = nextRegionalDayAt(c, P.clock.devRegionalTicks) + 1;
      catchUp(c, now, 1e9, { steps });
    }
    expect(t.tier).toBe(1);
    expect(t.parcelRights).toBe(2);
    expect(t.inbox.some((x) => x.kind === 'promotion')).toBe(true);
  });
});
