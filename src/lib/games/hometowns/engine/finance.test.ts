// WP2d finance (spec §5.13): the receipts and their bases, upkeep with the
// funding dials and civicUpkeepScale, level amortisation, the loan and bond
// moves with their caps, the overdraft, the credit rating's 3-month hold,
// and Helper Mode from trigger through escalation to exit or write-off (A16).

import { describe, expect, it } from 'vitest';
import { civicSteps, type CivicScript } from '../../../../../scripts/hometowns/civic-kit';
import { fixture } from '../../../../../scripts/hometowns/fixture';
import { runMonths } from '../../../../../scripts/hometowns/people-kit';
import { applyCommand } from './commands';
import { BUILDINGS, ROAD_DEFS, RAIL_DEF } from './content';
import { lineIndex, population, postWhole } from './core';
import { civicMemo, levelPayment, ratingTarget, upkeepOf } from './finance';
import { checkTown } from './invariants';
import { paramsFor } from './params';
import { CAT_RAIL, CAT_ROAD, TILES, pairSet, planesOf, tileIndex, useCat, usePayload } from './tiles';
import { EngineError, FUNDING_KEYS, FUND_HIGH, FUND_LOW, type CountyState, type LedgerLine, type TownState } from './types';

const P = paramsFor('v1');

function refused(f: () => unknown, status: number, text?: RegExp): void {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    expect((e as EngineError).status).toBe(status);
    if (text) expect((e as Error).message).toMatch(text);
    return;
  }
  throw new Error('expected a refusal');
}

/** A Town-tier fixture with every other package scripted (WP2d alone). */
function town(kind: 'hamlet' | 'town' | 'metropolis' = 'town') {
  const f = fixture(kind);
  return { c: f.county, i: f.town, t: f.county.towns[f.town], now: f.now };
}

/** A steady, tax-paying economy: £1.6m of rents, £2m turnover, £1m of shop takings. */
const STEADY: CivicScript = {
  housing: { rent: [300, 450, 800], occ: [1000, 2000, 500] },
  spend: { turnover: 1_000_000 },
  firms: { turnover: 2_000_000 },
  utilities: { importCost: 10_000, exportIncome: 2_500 },
  travel: { busShare: 0.1, railShare: 0 },
  labour: { employed: [1000, 1000, 500] },
};

/** A comfortable surplus for the town fixture (about £140k a month over its running costs). */
const RICH: CivicScript = { ...STEADY, firms: { turnover: 10_000_000 } };

const line = (lines: number[], l: LedgerLine) => lines[lineIndex(l)];

describe('receipts (M7c and M13)', () => {
  it('taxes each base at its rate, from the tier that unlocks it', () => {
    const { c, i, t } = town();
    const [d] = runMonths(c, i, 1, civicSteps(STEADY));
    const L = d.ledger!.lines;
    expect(line(L, 'homesTax')).toBe(128_000); // 8% of 300·1000 + 450·2000 + 800·500
    expect(line(L, 'businessTax')).toBe(80_000); // 4% of £2m
    expect(line(L, 'salesTax')).toBe(20_000); // 2% of £1m (Town and up)
    expect(line(L, 'fares')).toBe(12_600); // 2,500 commuters · 42 trips · 10% by bus · £1.20
    expect(line(L, 'utilityImports')).toBe(-10_000);
    expect(line(L, 'utilitySales')).toBe(2_500);
    expect(line(L, 'hotelTax')).toBe(0); // City only
    expect(checkTown(t)).toEqual([]);
  });

  it('charges no sales tax or fares below Town, and hotel tax from City', () => {
    const h = town('hamlet');
    const [dh] = runMonths(h.c, h.i, 1, civicSteps({ ...STEADY, tourism: { hotelNights: 1000 } }));
    expect(line(dh.ledger!.lines, 'salesTax')).toBe(0);
    expect(line(dh.ledger!.lines, 'fares')).toBe(0);
    const m = town('metropolis');
    const [dm] = runMonths(m.c, m.i, 1, civicSteps({ ...STEADY, tourism: { hotelNights: 1000 } }));
    expect(line(dm.ledger!.lines, 'hotelTax')).toBe(Math.round(0.05 * 1000 * 95));
  });

  it('carries fractions: a tiny base still pays its exact total over the months', () => {
    const { c, i, t } = town();
    t.taxes.homes = [10, 10, 10]; // 0.1%
    t.orders = []; // the Deputy would raise the rate as reserves fall
    const months = 37;
    const ds = runMonths(c, i, months, civicSteps({ ...RICH, housing: { rent: [3.3, 0, 0], occ: [17, 0, 0] } }));
    let paid = 0;
    for (const d of ds) paid += line(d.ledger!.lines, 'homesTax');
    const exact = 0.001 * 3.3 * 17 * months;
    expect(Math.abs(paid - exact)).toBeLessThan(1);
  });

  it('leaves Keep Homes Affordable to the rent: no second cut on top of WP2b’s ×0.8 inside the area', () => {
    const { c, i, t } = town();
    const [plain] = runMonths(c, i, 1, civicSteps(STEADY));
    t.policies.push({ card: 'keepHomesAffordable', sinceTick: t.tick, area: [0, 0, 64, 64] });
    for (let k = 0; k < TILES; k++) t.marks.push(k, 2);
    const [same] = runMonths(c, i, 1, civicSteps(STEADY));
    expect(line(same.ledger!.lines, 'homesTax')).toBe(line(plain.ledger!.lines, 'homesTax'));
  });
});

describe('upkeep (A14)', () => {
  it('is the catalogue upkeep × funding × civicUpkeepScale, roads by kind, the Town Hall per resident', () => {
    const { t } = town();
    const N = population(t);
    let civic = 0;
    let utilities = 0;
    for (const b of t.buildings) {
      const def = BUILDINGS[b[0]];
      const cost = def.upkeep + (def.upkeepPerResident ?? 0) * N;
      if (def.group === 'power' || def.group === 'water') utilities += cost;
      else civic += cost;
    }
    let roads = 0;
    const p = planesOf(t);
    for (let k = 0; k < TILES; k++) {
      if (useCat(p.use[k]) === CAT_ROAD) roads += ROAD_DEFS[usePayload(p.use[k])].upkeep;
      else if (useCat(p.use[k]) === CAT_RAIL) roads += RAIL_DEF.upkeep;
    }
    const u = upkeepOf(t, P);
    const scale = P.finance.civicUpkeepScale;
    expect(u.civic).toBeCloseTo(civic * scale, 6);
    expect(u.utilities).toBeCloseTo(utilities * scale, 6);
    expect(u.roads).toBe(roads);

    // Funding Low ×0.7 and High ×1.3 by each building's own dial.
    t.funding.fill(FUND_LOW);
    expect(upkeepOf(t, P).civic).toBeCloseTo(civic * scale * 0.7, 6);
    t.funding.fill(FUND_HIGH);
    expect(upkeepOf(t, P).utilities).toBeCloseTo(utilities * scale * 1.3, 6);
    expect(upkeepOf(t, P).roads).toBeCloseTo(roads * 1.3, 6);
    // The Lab's calibration knob scales every civic building, not the roads.
    const scaled = { ...P, finance: { ...P.finance, civicUpkeepScale: 1.25 } };
    t.funding.fill(1);
    expect(upkeepOf(t, scaled).civic).toBeCloseTo(civic * 1.25, 6);
    expect(upkeepOf(t, scaled).roads).toBe(roads);
  });

  it('pays nothing for a building still under construction', () => {
    const { t } = town();
    const before = upkeepOf(t, P).civic;
    const b = t.buildings.find((x) => BUILDINGS[x[0]].id === 'museum')!;
    pairSet(t.construction, tileIndex(b[1], b[2]), 2);
    expect(upkeepOf(t, P).civic).toBeCloseTo(before - BUILDINGS.find((d) => d.id === 'museum')!.upkeep * P.finance.civicUpkeepScale, 6);
  });
});

describe('level amortisation', () => {
  it('matches the closed form and clears the principal in exactly n payments', () => {
    // £120,000 over 120 months at 5%: P·r/(1 − (1 + r)^−n) with r = 0.05/12.
    const pay = levelPayment(120_000, 0.05, 120);
    expect(pay).toBeCloseTo(1272.7863, 3);
    let principal = 120_000;
    for (let k = 0; k < 120; k++) principal = principal * (1 + 0.05 / 12) - pay;
    expect(Math.abs(principal)).toBeLessThan(1e-6);
    expect(levelPayment(1200, 0, 12)).toBe(100);
  });
});

/** Runs one scripted month so the memo has a revenue base, then returns the county ready for moves. */
function withRevenue(kind: 'town' | 'metropolis' = 'town') {
  const s = town(kind);
  runMonths(s.c, s.i, 1, civicSteps(STEADY));
  return s;
}

const loan = (c: CountyState, seat: string, body: { take?: number; repay?: number }, now: number, id: string) => applyCommand(c, seat, { type: 'loan', moveId: id, ...body }, now);

describe('the Town Loan', () => {
  it('lends up to 12 months of revenue at r_base + 2%, and services it monthly', () => {
    const { c, i, t, now } = withRevenue();
    const seat = t.seat;
    const rev = civicMemo(t).revenue;
    refused(() => loan(c, seat, { take: Math.floor(12 * rev) + 1 }, now, 'l0'), 409, /at most/);
    const before = t.money.reserves;
    const r = loan(c, seat, { take: 1_000_000 }, now, 'l1');
    expect(r.cost).toBe(-1_000_000);
    expect(t.money.reserves).toBe(before + 1_000_000);
    expect(t.money.loan!.monthsLeft).toBe(120);
    expect(t.money.loan!.rate).toBeGreaterThan(0.02);
    refused(() => loan(c, seat, { take: 10 }, now, 'l2'), 409, /Pay back/);
    const pay = t.money.loan!.payment;
    const [d] = runMonths(c, i, 1, civicSteps(STEADY));
    expect(Math.abs(line(d.ledger!.lines, 'loanService') + pay)).toBeLessThan(1); // one carry
    expect(t.money.loan!.monthsLeft).toBe(119);
    expect(t.money.loan!.principal).toBeLessThan(1_000_000);
    expect(checkTown(t)).toEqual([]);
  });

  it('is paid off after its last payment', () => {
    const { c, i, t, now } = withRevenue();
    loan(c, t.seat, { take: 120_000 }, now, 'l1');
    const ds = runMonths(c, i, 120, civicSteps(STEADY));
    expect(t.money.loan).toBeNull();
    let paid = 0;
    for (const d of ds) paid -= line(d.ledger!.lines, 'loanService');
    expect(paid).toBeGreaterThan(120_000);
    expect(paid).toBeLessThan(120_000 * 1.3);
  });

  it('costs 1% to repay early, and refuses below Town or past the caps', () => {
    const { c, t, now } = withRevenue();
    loan(c, t.seat, { take: 500_000 }, now, 'l1');
    const before = t.money.reserves;
    const r = loan(c, t.seat, { repay: 200_000 }, now, 'l2');
    expect(r.cost).toBe(202_000);
    expect(t.money.reserves).toBe(before - 202_000);
    expect(Math.round(t.money.loan!.principal)).toBe(300_000);
    loan(c, t.seat, { repay: 300_000 }, now, 'l3');
    expect(t.money.loan).toBeNull();
    refused(() => loan(c, t.seat, { repay: 1 }, now, 'l4'), 409, /no Town Loan/);
    refused(() => loan(c, t.seat, { take: 1.5 }, now, 'l5'), 400);

    const h = withRevenue('town');
    h.t.tier = 1;
    refused(() => loan(h.c, h.t.seat, { take: 1000 }, h.now, 'x'), 409, /unlocks at Town/);
  });

  it('refuses new borrowing at a debt-service ratio of 25% or more', () => {
    const { c, t, now } = withRevenue();
    const rev = civicMemo(t).revenue;
    t.money.bonds.push({ id: 'old', issuedMonth: 0, principal: 1e7, rate: 0.05, monthsLeft: 120, payment: 0.3 * rev });
    refused(() => loan(c, t.seat, { take: 1000 }, now, 'l1'), 409, /quarter/);
  });
});

describe('bonds', () => {
  it('issue 3, 6 or 12 months of revenue at r_base + the rating spread (City and up)', () => {
    const { c, t, now } = withRevenue('metropolis');
    const rev = civicMemo(t).revenue;
    t.money.rating = 4; // BB
    const r = applyCommand(c, t.seat, { type: 'bond', moveId: 'b1', issue: { size: 6, years: 20 } }, now);
    const b = t.money.bonds[0];
    expect(b.principal).toBe(Math.floor(6 * rev));
    expect(b.monthsLeft).toBe(240);
    const town = withRevenue('town');
    refused(() => applyCommand(town.c, town.t.seat, { type: 'bond', moveId: 'b1', issue: { size: 3, years: 10 } }, town.now), 409, /City/);
    t.money.rating = 0;
    applyCommand(c, t.seat, { type: 'bond', moveId: 'b2', issue: { size: 3, years: 10 } }, now);
    expect(b.rate - t.money.bonds[1].rate).toBeCloseTo(P.finance.bondSpreads[4] - P.finance.bondSpreads[0], 9);
    expect(r.data!.id).toBe('bond-b1');
    const before = t.money.reserves;
    applyCommand(c, t.seat, { type: 'bond', moveId: 'b3', repay: { id: 'bond-b2' } }, now);
    const p2 = Math.floor(3 * rev);
    expect(t.money.reserves).toBe(before - p2 - Math.round(p2 * 0.01));
    expect(t.money.bonds.map((x) => x.id)).toEqual(['bond-b1']);
  });

  it('stop at total debt of two years of revenue', () => {
    const { c, t, now } = withRevenue('metropolis');
    applyCommand(c, t.seat, { type: 'bond', moveId: 'b1', issue: { size: 12, years: 20 } }, now);
    applyCommand(c, t.seat, { type: 'loan', moveId: 'l1', take: Math.floor(10 * civicMemo(t).revenue) }, now);
    refused(() => applyCommand(c, t.seat, { type: 'bond', moveId: 'b2', issue: { size: 3, years: 10 } }, now), 409, /two years/);
  });
});

// ---- The rating --------------------------------------------------------------------------------------

describe('the credit rating', () => {
  const m = { params: P, dayIndex: 10 };
  const books = (revenue: number, spending: number, debtService: number) => ({ revenue, spending, debtService });

  it('follows the §5.13 table', () => {
    const t = town().t;
    t.money.lastHelperDay = null;
    const at = (reserves: number, dsr: number) => {
      t.money.reserves = reserves;
      return ratingTarget(t, m, books(1000, 1000, dsr * 1000));
    };
    expect(at(3000, 0.04)).toBe(0); // AAA
    expect(at(2999, 0.04)).toBe(1); // AA: reserves under 3 months
    expect(at(5000, 0.07)).toBe(1);
    expect(at(1000, 0.11)).toBe(2); // A
    expect(at(500, 0.15)).toBe(3); // BBB
    expect(at(-100, 0.19)).toBe(4); // BB: any reserves
    expect(at(9000, 0.2)).toBe(5); // B: DSR ≥ 20%
    t.money.overdraftMonths = 4;
    expect(at(9000, 0)).toBe(5); // B: overdrawn for more than 3 months
    t.money.overdraftMonths = 0;
    t.money.lastHelperDay = 9; // a Helper Mode episode in the last 24 months costs a notch
    expect(at(9000, 0)).toBe(1);
    t.money.lastHelperDay = 7;
    expect(at(9000, 0)).toBe(0);
  });

  it('needs its condition for 3 months to move one notch, and moves one notch at a time', () => {
    const { c, i, t } = town();
    postWhole(t, 'other', 1e9); // far more than 3 months of spending: the numbers say AAA
    t.books.open = t.money.reserves;
    t.books.lines.fill(0);
    t.money.rating = 4;
    const seen: number[] = [];
    runMonths(c, i, 12, civicSteps(STEADY), () => seen.push(t.money.rating));
    expect(seen).toEqual([4, 4, 3, 3, 3, 2, 2, 2, 1, 1, 1, 0]);

    // A month whose numbers match the current rating resets the hold.
    const s = town();
    postWhole(s.t, 'other', 1e9);
    s.t.money.rating = 4;
    const holds: number[] = [];
    let k = 0;
    runMonths(s.c, s.i, 4, civicSteps(STEADY), () => {
      holds.push(s.t.money.ratingHold);
      if (++k === 2) s.t.money.rating = 0;
    });
    expect(holds).toEqual([1, 2, 0, 0]);
    expect(s.t.money.rating).toBe(0);
  });
});

// ---- Helper Mode ---------------------------------------------------------------------------------------

/** Runs months with the county's day advancing every 12 months (a Regional Day's worth). */
function runDays(c: CountyState, i: number, months: number, script: CivicScript | ((t: TownState) => CivicScript), each?: (k: number) => void): void {
  let k = 0;
  const steps = civicSteps(typeof script === 'function' ? (t) => script(t) : script);
  runMonths(c, i, months, steps, () => {
    k++;
    if (k % 12 === 0) c.dayIndex += 1;
    each?.(k);
  });
}

const DEFICIT: CivicScript = { ...STEADY, utilities: { importCost: 3_000_000 } };

describe('Helper Mode (§5.13, A16)', () => {
  it('starts when reserves fall below −1 month of spending, and takes a 0% advance to zero', () => {
    const { c, i, t } = town();
    postWhole(t, 'other', -t.money.reserves - 5_000_000); // deep in the red
    t.policies.push({ card: 'litterPickers', sinceTick: 0, area: null }, { card: 'cleanAirRules', sinceTick: 0, area: null });
    runDays(c, i, 1, STEADY);
    const h = t.money.helper!;
    expect(h).not.toBeNull();
    expect(h.step).toBe(0);
    expect(t.money.reserves).toBe(0);
    expect(h.advance).toBeGreaterThan(5_000_000);
    expect(t.funding[FUNDING_KEYS.indexOf('fun')]).toBe(FUND_LOW);
    expect(t.funding[FUNDING_KEYS.indexOf('culture')]).toBe(FUND_LOW);
    expect(t.taxes.homes.every((v) => v >= 1000)).toBe(true);
    expect(t.taxes.business).toBeGreaterThanOrEqual(500);
    // Optional (costly) cards are paused; free ones stay.
    expect(t.policies.map((a) => a.card)).toEqual(['cleanAirRules']);
    expect(civicMemo(t).paused.map((a) => a.card)).toEqual(['litterPickers']);
    expect(t.inbox.some((x) => x.kind === 'deputy.helper.enter')).toBe(true);
    expect(checkTown(t)).toEqual([]);
  });

  it('starts after three month ends below zero, even when shallow', () => {
    const { c, i, t } = town();
    t.orders = [];
    postWhole(t, 'other', -t.money.reserves);
    // Revenue £1,000 a month short of running costs: never a month of spending in the red.
    const u = upkeepOf(t, P);
    const short = u.civic + u.utilities + u.roads - 1000;
    const seen: (number | null)[] = [];
    const advance: number[] = [];
    runDays(c, i, 3, { housing: { rent: [0, 0, 0], occ: [0, 0, 0] }, firms: { turnover: short / 0.04 } }, () => {
      seen.push(t.money.helper ? t.money.overdraftMonths : null);
      advance.push(t.money.helper?.advance ?? 0);
    });
    expect(seen).toEqual([null, null, 3]);
    expect(advance[2]).toBeGreaterThan(2000); // about three months of the £1,000 gap
    expect(advance[2]).toBeLessThan(4000);
    expect(t.money.reserves).toBe(0);
  });

  it('pauses non-essential builds and keeps Fun and Culture on Low until it ends', () => {
    const { c, i, t, now } = town();
    postWhole(t, 'other', -t.money.reserves - 5_000_000);
    runDays(c, i, 1, STEADY);
    refused(() => applyCommand(c, t.seat, { type: 'build', planId: 'p1', plan: [{ op: 'place', id: 'museum', x: 1, y: 1, rot: 0 }] }, now), 409);
    refused(() => applyCommand(c, t.seat, { type: 'budget', moveId: 'b1', funding: { fun: 2 } }, now), 409, /Fun and Culture/);
    refused(() => applyCommand(c, t.seat, { type: 'budget', moveId: 'b2', taxes: { homes: 800 } }, now), 409, /keeping taxes/);
  });

  it('repays the advance from surpluses and ends when reserves cover a month of spending', () => {
    const { c, i, t } = town();
    t.policies.push({ card: 'litterPickers', sinceTick: 0, area: null });
    postWhole(t, 'other', -t.money.reserves - 2_000_000);
    let prev = t.money.rating;
    let exit: { k: number; rating: number; prev: number; reserves: number; spending: number } | null = null;
    let k = 0;
    let advanced = 0;
    runDays(c, i, 60, RICH, () => {
      k++;
      if (t.money.helper) advanced = Math.max(advanced, t.money.helper.advance);
      if (!t.money.helper && advanced > 0 && !exit) exit = { k, rating: t.money.rating, prev, reserves: t.money.reserves, spending: civicMemo(t).spending };
      prev = t.money.rating;
    });
    expect(advanced).toBeGreaterThan(1_000_000);
    expect(exit).not.toBeNull();
    const e = exit!;
    expect(e.k).toBeGreaterThan(1);
    expect(e.reserves).toBeGreaterThanOrEqual(e.spending);
    // The comeback costs a notch (the month's own review moves at most one more).
    expect(e.rating).toBeGreaterThanOrEqual(e.prev);
    expect(t.money.lastHelperDay).not.toBeNull();
    expect(t.money.fundAdvance).toBe(0);
    expect(t.inbox.some((x) => x.kind === 'deputy.helper.exit')).toBe(true);
    // Paused cards come back.
    expect(t.policies.map((a) => a.card)).toEqual(['litterPickers']);
    expect(checkTown(t)).toEqual([]);
  });

  it('escalates at day 3 and day 6 and always ends by day 10, written off, rated B', () => {
    const { c, i, t } = town();
    postWhole(t, 'other', -t.money.reserves - 5_000_000);
    const steps: number[] = [];
    let longest = 0;
    let since = -1;
    runDays(c, i, 12 * 14, DEFICIT, () => {
      const h = t.money.helper;
      if (h) {
        if (since < 0) since = h.sinceDay;
        longest = Math.max(longest, c.dayIndex - h.sinceDay);
        if (steps[steps.length - 1] !== h.step) steps.push(h.step);
        if (h.step >= 1) for (const k of ['fun', 'culture', 'transit', 'roads', 'utilities'] as const) expect(t.funding[FUNDING_KEYS.indexOf(k)]).toBe(FUND_LOW);
        if (h.step >= 2) {
          expect(t.taxes.homes.every((v) => v >= 1200)).toBe(true);
          expect(t.taxes.business).toBeGreaterThanOrEqual(600);
        }
        // Safety and Learning & Health are never cut.
        for (const k of ['police', 'fire', 'health', 'education'] as const) expect(t.funding[FUNDING_KEYS.indexOf(k)]).toBe(1);
      }
    });
    expect(steps.slice(0, 3)).toEqual([0, 1, 2]);
    expect(longest).toBeLessThanOrEqual(P.finance.helperWriteOffDays);
    const off = t.inbox.filter((x) => x.kind === 'deputy.helper.writeOff');
    expect(off.length).toBeGreaterThan(0);
    expect(checkTown(t)).toEqual([]);
  });

  it('sets the rating to B at a write-off', () => {
    const { c, i, t } = town();
    postWhole(t, 'other', -t.money.reserves - 5_000_000);
    let atWriteOff: number | null = null;
    runDays(c, i, 12 * 11, DEFICIT, () => {
      if (atWriteOff === null && t.inbox.some((x) => x.kind === 'deputy.helper.writeOff')) atWriteOff = t.money.rating;
    });
    expect(atWriteOff).toBe(5);
  });
});

describe('no borrowing on Kingsport’s account (review amendment to §5.13)', () => {
  it('refuses a loan in Helper Mode and for two days after a write-off, then lends again', () => {
    const { c, t, now } = withRevenue();
    t.money.helper = { sinceDay: c.dayIndex, sinceTick: t.tick, advance: 0, step: 0 };
    refused(() => loan(c, t.seat, { take: 1000 }, now, 'h1'), 409, /helping/);
    t.money.helper = null;
    t.money.lastWriteOffDay = c.dayIndex;
    refused(() => loan(c, t.seat, { take: 1000 }, now, 'h2'), 409, /cleared our debts/);
    c.dayIndex += P.finance.writeOffBorrowBarDays - 1;
    refused(() => loan(c, t.seat, { take: 1000 }, now, 'h3'), 409, /cleared our debts/);
    c.dayIndex += 1;
    expect(loan(c, t.seat, { take: 1000 }, now, 'h4').cost).toBe(-1000);
  });

  it('a write-off records its day', () => {
    const { c, i, t } = town();
    postWhole(t, 'other', -t.money.reserves - 5_000_000);
    runDays(c, i, 12 * 11, DEFICIT, () => {});
    expect(t.money.lastWriteOffDay).not.toBeNull();
  });
});

describe('the overdraft', () => {
  it('charges r_base + 8% a year on what is overdrawn', () => {
    const { c, i, t } = town();
    postWhole(t, 'other', -t.money.reserves - 100_000);
    const [d] = runMonths(c, i, 1, civicSteps({ ...STEADY, housing: { rent: [0, 0, 0], occ: [0, 0, 0] }, firms: { turnover: 0 }, spend: { turnover: 0 }, travel: { busShare: 0 }, utilities: {} }));
    const interest = line(d.ledger!.lines, 'interest');
    expect(interest).toBeLessThan(0);
    // Overdrawn by more than £100k (upkeep came first), at between 9.5% and 14% a year.
    expect(-interest).toBeGreaterThan((100_000 * 0.095) / 12);
    expect(-interest).toBeLessThan((t.money.reserves < 0 ? -t.money.reserves : 2e6) * 0.14);
  });
});
