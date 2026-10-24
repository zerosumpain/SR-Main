// WP2c firms and business meters (spec §5.12 with A5, A6, A7 and A9):
// farms pay at baseline (the critic's −45% is gone), business tax bites
// margins and then the meter, the empty-sector bootstrap shows demand in a
// fresh hamlet and is capped, the supply line and unfilled slots hold
// demand back, unreachable meters are capped, and the Why names the causes.

import { describe, expect, it } from 'vitest';
import { FIXTURE_EPOCH, fixture, foundAndSprint, newCounty } from '../../../../../scripts/hometowns/fixture';
import { marketSteps, marketSupply, scriptedLabour } from '../../../../../scripts/hometowns/market-kit';
import { monthContext, runMonths } from '../../../../../scripts/hometowns/people-kit';
import { SECTOR_METER, stepFirms } from './business';
import { neutralFlows } from './core';
import { neutral } from './derived';
import { T } from './fx';
import { stepLabour } from './labour';
import { paramsFor } from './params';
import { S_FARMS, S_INDUSTRY, S_OFFICES, S_SHOPS, stepSpending } from './trade';
import { stepTourism } from './tourism';
import {
  METER_FARMS,
  METER_INDUSTRY,
  METER_OFFICES,
  METER_SHOPS,
  SECTOR_COUNT,
  STAGE_C,
  STAGE_P,
  STAGE_W,
  person,
  type CountyState,
  type DerivedCache,
  type MonthContext,
  type TownState,
} from './types';

const P = paramsFor('v1');
const scripted = (fill: number | 'people' = 'people') => marketSteps({ labour: { fill }, fields: { safety: 70 } });

function town(kind: 'hamlet' | 'town' | 'metropolis' = 'town') {
  const f = fixture(kind);
  return { c: f.county, i: f.town, t: f.county.towns[f.town] };
}

/** Runs M6, M7b and M8 once on a context whose upstream slots are already set. */
function market(t: TownState, m: MonthContext): DerivedCache {
  stepTourism(t, m);
  stepSpending(t, m);
  stepFirms(t, m);
  return m.derived;
}

/** A context with the supply counted from the tiles and scripted labour (or WP2b's real labour step). */
function ctx(c: CountyState, i: number, t: TownState, realLabour = false, over: Partial<DerivedCache> = {}) {
  c.snapshot.flows = c.towns.map(() => neutralFlows());
  const dev = over.development ?? marketSupply(t);
  const m = monthContext(c, i, { development: dev, fields: { ...neutral.fields(t), safety: 70 }, coverage: neutral.coverage(t), ...over });
  m.world = { ...m.world, goods: 1, office: 1, tourism: 1, event: null };
  if (realLabour) stepLabour(t, m);
  else if (!over.labour) m.derived.labour = scriptedLabour(t, dev);
  return m;
}

describe('farms pay at baseline (A7; the critic found −45% to −60%)', () => {
  it('a hamlet’s farms run well above the normal 8% margin with WP2b’s real labour market', () => {
    const { c, i, t } = town('hamlet');
    const d = runMonths(c, i, 6, marketSteps({ labour: false, fields: { safety: 70 } }));
    const last = d[d.length - 1].firms!;
    expect(last.jobs[S_FARMS]).toBeGreaterThan(0);
    expect(last.margin[S_FARMS]).toBeGreaterThan(P.meters.normalMargin);
    expect(t.margins[S_FARMS]).toBeGreaterThan(P.meters.normalMargin);
    expect(t.meters[METER_FARMS]).toBeGreaterThan(0);
  });

  it('and still pay at the full £1,600 wage (Prod 1), where the critic’s arithmetic lost money', () => {
    const { c, i, t } = town('hamlet');
    const m = ctx(c, i, t);
    expect(m.derived.labour!.wage[0]).toBe(1600);
    const d = market(t, m);
    expect(d.firms!.margin[S_FARMS]).toBeGreaterThan(0);
    // A farm tile: 3 jobs make 100 food units, worth £6,000 at the county price against £4,800 of wages.
    expect(P.firms.farmFood * P.firms.foodUnit).toBeGreaterThan(3 * P.labour.W0[0]);
  });
});

describe('business tax bites honestly (§5.12)', () => {
  it('raising business tax lowers every open sector’s margin, and then its meter', () => {
    const run = (bp: number) => {
      const { c, i, t } = town();
      t.taxes.business = bp;
      const months = runMonths(c, i, 8, scripted());
      return { first: months[0].firms!, t };
    };
    const low = run(400);
    const high = run(1200);
    let open = 0;
    for (let s = 0; s < SECTOR_COUNT; s++) {
      if (low.first.jobs[s] <= 0) continue;
      open++;
      expect(high.first.margin[s], `sector ${s}`).toBeLessThan(low.first.margin[s]);
      expect(high.t.margins[s]).toBeLessThan(low.t.margins[s]);
      expect(high.t.meters[SECTOR_METER[s]]).toBeLessThan(low.t.meters[SECTOR_METER[s]]);
    }
    expect(open).toBeGreaterThanOrEqual(3);
  });

  it('the tax is a named cost in the meter’s Why', () => {
    const { c, i, t } = town();
    t.taxes.business = 1200;
    const m = ctx(c, i, t);
    const adds: [string, number, string | undefined][] = [];
    const spy: MonthContext = { ...m, why: { add: (k, a, q) => void adds.push([k, a, q]), set: () => {} } };
    market(t, spy);
    const tax = adds.find(([k, , q]) => k === 'meter.biz.tax' && q === 'meter.shops');
    expect(tax).toBeDefined();
    expect(tax![1]).toBeLessThan(0);
    expect(adds.find(([k, , q]) => k === 'meter.biz.demand' && q === 'meter.shops')![1]).toBeGreaterThan(0);
  });
});

describe('the empty-sector bootstrap (§5.12, A6)', () => {
  /** A freshly founded town (Town Hall only, no zones) with `n` £ founders: half Workers, half Families. */
  function fresh(n: number) {
    const c = newCounty(7);
    const { index } = foundAndSprint(c, 'kid', 0, FIXTURE_EPOCH + 1000);
    const t = c.towns[index];
    t.people.fill(0);
    t.people[person(STAGE_W, 0)] = Math.round(n / 2);
    t.people[person(STAGE_P, 0)] = Math.round(n / 4);
    t.people[person(STAGE_C, 0)] = n - Math.round(n / 2) - Math.round(n / 4);
    // As the founders' carts (WP2e) would have left it: the fortnight's empty months never happened (A11 starts).
    t.margins.fill(P.start.margin);
    t.meters = [...P.start.meters];
    return { c, i: index, t };
  }

  it('a fresh hamlet with spending and no shop or workshop wants both', () => {
    const { c, i, t } = fresh(150);
    const shops0 = t.meters[METER_SHOPS];
    // Four pay days with nothing built: the smoothed margins (τ 4) settle toward the bootstrap's.
    let d = market(t, ctx(c, i, t, true));
    for (let k = 0; k < 3; k++) d = market(t, ctx(c, i, t, true));
    const f = d.firms!;
    expect(f.jobs[S_SHOPS]).toBe(0);
    expect(f.jobs[S_INDUSTRY]).toBe(0);
    expect(f.rev[S_SHOPS]).toBe(0); // nobody sells yet
    expect(f.margin[S_SHOPS]).toBeGreaterThan(P.meters.normalMargin);
    // Kingsport always buys goods: the export-base floor (near the +30% cap).
    expect(f.margin[S_INDUSTRY]).toBeGreaterThan(0.2);
    expect(f.margin[S_INDUSTRY]).toBeLessThanOrEqual(P.firms.bootstrapMarginCap);
    expect(f.target[S_SHOPS]).toBeGreaterThan(0);
    expect(f.target[S_INDUSTRY]).toBeGreaterThan(30);
    expect(f.labourGate[S_SHOPS]).toBe(1); // plenty of £ hands to hire
    expect(t.meters[METER_SHOPS]).toBeGreaterThan(0);
    expect(t.meters[METER_INDUSTRY]).toBeGreaterThan(0);
    expect(shops0).toBe(P.start.meters[METER_SHOPS]);
  });

  it('caps the imagined sector’s margin at +30%: a hamlet’s offices do not boom (A6), and the meter it cannot act on stops at +35 (A9)', () => {
    const { c, i, t } = town('hamlet');
    const d = runMonths(c, i, 24, scripted());
    const f = d[d.length - 1].firms!;
    expect(f.jobs[S_OFFICES]).toBe(0);
    expect(f.margin[S_OFFICES]).toBe(P.firms.bootstrapMarginCap);
    expect(t.margins[S_OFFICES]).toBeLessThanOrEqual(P.firms.bootstrapMarginCap + 1e-9);
    // The uncapped target would be 100·T(4·(0.30 − 0.08)) ≈ 71; Offices cannot be zoned in a Hamlet.
    expect(f.target[S_OFFICES]).toBeCloseTo(100 * T(P.meters.bizGain * (P.firms.bootstrapMarginCap - P.meters.normalMargin)), 0);
    expect(t.meters[METER_OFFICES]).toBeLessThanOrEqual(P.meters.unreachableCap);
  });
});

describe('demand that waits for what is already coming (A5, A6)', () => {
  it('jobs under construction lower the supply-line margin and the target, not the reported margin', () => {
    const go = (pipe: number) => {
      const { c, i, t } = town();
      const dev = marketSupply(t);
      dev.pipeJobs[S_SHOPS * 3] += pipe;
      const m = ctx(c, i, t, false, { development: dev });
      const f = market(t, m).firms!;
      return { f, t };
    };
    const none = go(0);
    const lots = go(400);
    expect(lots.t.margins[S_SHOPS]).toBeCloseTo(none.t.margins[S_SHOPS], 12);
    expect(lots.t.margins[5 + S_SHOPS]).toBeLessThan(none.t.margins[5 + S_SHOPS]);
    expect(lots.f.target[S_SHOPS]).toBeLessThan(none.f.target[S_SHOPS]);
  });

  it('a sector that cannot staff its jobs does not want more: unfilled slots and the labour gate', () => {
    const go = (fill: number) => {
      const { c, i, t } = town();
      const dev = marketSupply(t);
      const lab = scriptedLabour(t, dev, { fill });
      const m = ctx(c, i, t, false, { development: dev, labour: lab });
      return market(t, m).firms!;
    };
    const full = go(1);
    const half = go(0.5);
    for (let s = 0; s < SECTOR_COUNT; s++) {
      if (full.jobs[s] <= 0) continue;
      expect(half.unfilled[s]).toBeGreaterThan(0);
      expect(half.labourGate[s]).toBe(0); // (0.5 − 0.6)/0.3 < 0
      // Growth is held back (gate 0), and the empty slots push the target down (A5).
      expect(half.target[s]).toBeLessThanOrEqual(0);
      expect(half.target[s]).toBeLessThan(full.target[s]);
    }
  });

  it('a sector losing more than 15% counts the months toward closures (WP2e reads them)', () => {
    const { c, i, t } = town();
    // The town fixture has far more office jobs than its outside demand pays for.
    runMonths(c, i, 4, scripted());
    expect(t.margins[S_OFFICES]).toBeLessThan(P.firms.closeMargin);
    expect(t.marketMemo!.lowMonths[S_OFFICES]).toBeGreaterThanOrEqual(2);
  });
});

describe('policy cards', () => {
  it("Start-up Holiday exempts young tiles from business tax; Clean Air Rules add 6% to industry's costs; a Farmers' Market adds 10 to the Shops target", () => {
    const go = (cards: string[]) => {
      const { c, i, t } = town();
      for (const card of cards) t.policies.push({ card, sinceTick: 0, area: null });
      const m = ctx(c, i, t);
      return market(t, m).firms!;
    };
    const base = go([]);
    const clean = go(['cleanAirRules']);
    expect(clean.cost[S_INDUSTRY]).toBeCloseTo(base.cost[S_INDUSTRY] * P.firms.cleanAirCost, 6);
    const fm = go(['farmersMarket']);
    expect(fm.target[S_SHOPS]).toBeCloseTo(Math.min(100, base.target[S_SHOPS] + P.firms.farmersMarket), 6);
    const holiday = go(['startupHoliday']);
    expect(holiday.turnover).toBeLessThanOrEqual(base.turnover);
  });
});
