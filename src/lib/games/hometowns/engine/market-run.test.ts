// WP2c over long runs. The acceptance test is the resort cycle (spec §5.10,
// Butler): nothing below scripts visitors, satisfaction, reputation or the
// hotel trade. A well-known seaside town with no hotels is left to its own
// market: the Leisure meter asks for hotels, a stand-in for WP2e's
// development rules builds them as the meter allows, and the cycle has to
// come out of the loops on its own. Then the mayor opens a museum, the cure
// the spec names. A second run holds every live package's steps on the
// golden fixtures for years and checks the market stays in range, alert-free
// and deterministic.

import { describe, expect, it } from 'vitest';
import { FIXTURE_KINDS, fixture } from '../../../../../scripts/hometowns/fixture';
import { hotelBeds, hotelDeveloper, marketSteps, marketSupply, placeFree, seasideTown } from '../../../../../scripts/hometowns/market-kit';
import { runMonths } from '../../../../../scripts/hometowns/people-kit';
import { BEACH } from './content';
import { stateHash } from './index';
import { checkTown } from './invariants';
import { paramsFor } from './params';
import { withSteps } from './steps';
import { METER_LEISURE, type CountyState, type MonthStep } from './types';

const P = paramsFor('v1');

interface Row {
  k: number;
  visitors: number;
  stays: number;
  beds: number;
  bedCap: number;
  sat: number;
  rep: number;
  meter: number;
}

function runSeaside(months: number, museumAt: number): Row[] {
  const { c, i } = seasideTown();
  const t = c.towns[i];
  const steps = marketSteps({ labour: {}, fields: { safety: 70 }, coverage: { town: [0, 0, 0, 0, 40, 0, 0, 0] } }, [hotelDeveloper()]);
  const rows: Row[] = [];
  for (let k = 0; k < months; k++) {
    if (k === museumAt) expect(placeFree(t, 'museum')).toBe(true);
    const [d] = runMonths(c, i, 1, steps);
    const tr = d.tourism!;
    expect(t.alerts).toEqual([]);
    rows.push({
      k,
      visitors: tr.stays + tr.dayTrips,
      stays: tr.stays,
      beds: tr.beds,
      bedCap: tr.beds * P.tourism.staysPerBed * P.tourism.maxOccupancy,
      sat: tr.satisfaction,
      rep: t.rep,
      meter: t.meters[METER_LEISURE],
    });
  }
  expect(hotelBeds(t)).toBeGreaterThan(0);
  return rows;
}

const argmax = (rows: Row[], f: (r: Row) => number) => rows.reduce((b, r) => (f(r) > f(b) ? r : b), rows[0]);
const argmin = (rows: Row[], f: (r: Row) => number) => rows.reduce((b, r) => (f(r) < f(b) ? r : b), rows[0]);

describe('the resort cycle emerges unscripted (§5.10, B3 and R4)', () => {
  const MUSEUM = 150;
  const rows = runSeaside(220, MUSEUM);
  const before = rows.slice(0, MUSEUM);
  const crowdCap = BEACH.visitorCap + P.tourism.baseCap;

  it('booms: the Leisure meter asks for hotels, beds go up and visitors pour in', () => {
    const meterPeak = argmax(before.slice(0, 24), (r) => r.meter);
    expect(meterPeak.meter).toBeGreaterThan(50);
    const bedPeak = argmax(before, (r) => r.beds);
    expect(bedPeak.beds).toBeGreaterThan(800);
    expect(argmax(before, (r) => r.visitors).visitors).toBeGreaterThan(3 * rows[6].visitors);
  });

  it('crowds the beach, and satisfaction falls at once', () => {
    const peak = argmax(before, (r) => r.visitors);
    expect(peak.visitors).toBeGreaterThan(crowdCap * 1.3);
    expect(argmin(before, (r) => r.sat).sat).toBeLessThan(rows[0].sat - 15);
  });

  it('reputation falls about a day later, after the hotels are built, and stays down', () => {
    const crowdedFrom = before.find((r) => r.visitors > crowdCap)!.k;
    const repPeak = argmax(before, (r) => r.rep);
    // Ten points down within two real days (24 county months) of the first crowded month.
    const down = before.find((r) => r.k > crowdedFrom && r.rep < repPeak.rep - 10)!;
    expect(down.k - crowdedFrom).toBeLessThanOrEqual(24);
    // Most of the hotels were already there when reputation turned.
    const bedPeak = argmax(before, (r) => r.beds);
    expect(rows[down.k].beds).toBeGreaterThan(0.5 * bedPeak.beds);
    // And it stays down until the cure: every month from then to the museum is at least 10 below the peak.
    for (const r of before.filter((x) => x.k >= down.k + 12)) expect(r.rep).toBeLessThan(repPeak.rep - 10);
  });

  it('busts the hotel trade: half-empty rooms, a negative meter and closures', () => {
    const bedPeak = argmax(before, (r) => r.beds);
    const late = before.slice(60);
    // Rooms that were full in the boom are well under half full.
    expect(Math.max(...late.map((r) => r.stays / r.bedCap))).toBeLessThan(0.75);
    // The meter spends the bust below zero, and the town has fewer beds than at the peak.
    expect(late.filter((r) => r.meter < 0).length / late.length).toBeGreaterThan(0.8);
    expect(Math.min(...late.map((r) => r.beds))).toBeLessThan(bedPeak.beds * 0.85);
  });

  it('a new attraction is the cure: reputation and visitors recover', () => {
    const atCure = rows[MUSEUM - 1];
    const after = rows.slice(MUSEUM, MUSEUM + 36);
    expect(Math.max(...after.map((r) => r.rep))).toBeGreaterThan(atCure.rep + 5);
    expect(Math.max(...after.map((r) => r.visitors))).toBeGreaterThan(atCure.visitors * 1.15);
  });
});

describe('the market over years of game time, with every live step', () => {
  const MONTHS = { hamlet: 48, town: 24, metropolis: 12 } as const;
  // Every package's real step, except that the supply is counted from the tiles until WP2e's lands.
  const supply: MonthStep = (t, m) => void (m.derived.development = marketSupply(t));
  const LIVE = withSteps({ 'M1b supply': supply });

  it.each(FIXTURE_KINDS)('%s: in range, alert-free and finite every month', (kind) => {
    const f = fixture(kind);
    const t = f.county.towns[f.town];
    runMonths(f.county, f.town, MONTHS[kind], LIVE, (k, d) => {
      expect(t.alerts, `month ${k}`).toEqual([]);
      expect(checkTown(t)).toEqual([]);
      expect(t.meters.slice(3).every((x) => x >= -100 && x <= 100)).toBe(true);
      expect(t.margins.every(Number.isFinite)).toBe(true);
      expect(t.rep >= 0 && t.rep <= 100 && t.aw >= 0 && t.aw <= 1).toBe(true);
      expect(t.goodsStock.every((x) => x >= 0 && Number.isFinite(x))).toBe(true);
      const fm = d.firms!;
      expect([...fm.rev, ...fm.cost, fm.turnover, d.spend!.turnover, d.tourism!.stays].every((x) => Number.isFinite(x) && x >= 0)).toBe(true);
    });
  });

  it('is deterministic, and a revive mid-run (JSON round trip) continues identically', () => {
    const run = (revive: boolean) => {
      const f = fixture('town');
      let c: CountyState = f.county;
      runMonths(c, f.town, 6, LIVE);
      if (revive) c = JSON.parse(JSON.stringify(c)) as CountyState;
      runMonths(c, f.town, 6, LIVE);
      return stateHash(c.towns[f.town]);
    };
    const a = run(false);
    expect(run(false)).toBe(a);
    expect(run(true)).toBe(a);
  });
});
