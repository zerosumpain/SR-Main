// Services and coverage (§5.4, §6.3–§6.5, A14, A41): falloff, the running
// multipliers, capacity against demand, EduQ, health, staff demand.

import { describe, expect, it } from 'vitest';
import { kitTown, monthOf, people, place, road, zoneRect, type Kit } from '../../../../../scripts/hometowns/space-kit';
import { COV, diamondBlur, servicesOf, type Services } from './services';
import { cellDistance, runFor } from './space';
import { CELLS, CELLS_PER_SIDE, cellOf, tileIndex } from './tiles';
import { FUNDING_KEYS, FUND_LOW, type FundingKey } from './types';

function services(k: Kit): Services {
  const m = monthOf(k);
  return servicesOf(runFor(k.t, m, m.derived));
}

/** A street with a Windmill (so civic buildings are powered) and a Constable Post at (20, 21). */
function postTown(o: { power?: boolean; road?: boolean } = {}): Kit {
  const k = kitTown();
  road(k.t, 10, 20, 40, 20);
  if (o.power !== false) place(k.t, 'windmill', 10, 21);
  place(k.t, 'constablePost', 20, o.road === false ? 30 : 21);
  return k;
}

const cell = (x: number, y: number) => y * CELLS_PER_SIDE + x;

describe('coverage falloff (§5.4)', () => {
  it('is the full strength to half the radius and fades linearly to zero at the radius', () => {
    const s = services(postTown());
    const pol = s.slot.cov[COV.police];
    // The post's centre is tile (20.5, 21.5); its radius of 10 tiles is 5 cells, full to 2.5.
    expect(pol[cellOf(tileIndex(20, 21))]).toBe(40);
    const c = cell(12, 11); // centre tile (25, 23): 3 cells away
    expect(cellDistance(c, 20.5, 21.5)).toBe(3);
    expect(pol[c]).toBeCloseTo(40 * ((5 - 3) / 2.5), 12);
    expect(pol[cell(14, 11)]).toBe(0); // 5 cells away
    // Everything outside the radius is untouched.
    let covered = 0;
    for (let k = 0; k < CELLS; k++) if (pol[k] > 0) covered++;
    expect(covered).toBeLessThan(80);
  });

  it('halves for no power and for no road, and follows staff and the funding dial', () => {
    const at = cellOf(tileIndex(20, 21));
    expect(services(postTown({ power: false })).slot.cov[COV.police][at]).toBe(20);
    // Off the road it is also off every grid, so unpowered too: ½ × ½.
    const noRoad = services(postTown({ road: false })).slot.cov[COV.police][cellOf(tileIndex(20, 30))];
    expect(noRoad).toBe(10);
    const k = postTown();
    k.t.buildings[1][7] = 500; // half staffed
    expect(services(k).slot.cov[COV.police][at]).toBe(20);
    expect(services(k).slot.effect[1]).toBe(1); // effect is before staffing
    const low = postTown();
    low.t.funding[FUNDING_KEYS.indexOf('police' as FundingKey)] = FUND_LOW;
    expect(services(low).slot.cov[COV.police][at]).toBe(30);
  });

  it('fades with Cap/Demand: a 3,000-person post with 6,000 people in reach works at half strength', () => {
    const k = postTown();
    zoneRect(k.t, 18, 22, 6, 4, 'homes', 5, 0); // 24 towers × 260 = 6,240 capacity, all within reach
    people(k.t, 0, 6000);
    const s = services(k);
    expect(s.slot.effect[1]).toBeCloseTo(0.5, 12);
    expect(s.slot.cov[COV.police][cellOf(tileIndex(20, 21))]).toBeCloseTo(20, 9);
  });

  it('skips buildings under construction or closed, and bus stops without a depot', () => {
    const k = kitTown();
    road(k.t, 10, 20, 40, 20);
    place(k.t, 'windmill', 10, 21);
    place(k.t, 'surgery', 20, 21, { building: true });
    place(k.t, 'fireVolunteers', 24, 21, { damaged: 3 });
    place(k.t, 'busStop', 28, 21);
    let s = services(k);
    expect(s.slot.cov[COV.health][cellOf(tileIndex(20, 21))]).toBe(0);
    expect(s.slot.cov[COV.fire][cellOf(tileIndex(24, 21))]).toBe(0);
    expect(s.slot.cov[COV.transit][cellOf(tileIndex(28, 21))]).toBe(0);
    place(k.t, 'busDepot', 30, 21);
    s = services(k);
    expect(s.slot.cov[COV.transit][cellOf(tileIndex(28, 21))]).toBe(40);
    expect(s.bus[cellOf(tileIndex(28, 21))]).toBe(40);
  });
});

describe('schools, health and staff (services.ts, A41)', () => {
  it('measures EduQ as min(1, seats/pupils) × the families covered × quality', () => {
    const k = kitTown();
    road(k.t, 10, 20, 40, 20);
    place(k.t, 'windmill', 10, 21);
    place(k.t, 'villageSchool', 20, 21); // 200 seats, quality 0.9, radius 10
    zoneRect(k.t, 18, 22, 4, 2, 'homes', 4, 0); // 8 × 120 = 960 capacity next to it
    people(k.t, 0, 200, 300, 400, 0); // 400 children: 240 primary-age
    const s = services(k);
    expect(s.slot.pupils.primary).toBeCloseTo(240, 9);
    expect(s.slot.seats.primary).toBe(200);
    expect(s.slot.eduQ[0]).toBeCloseTo((200 / 240) * 1 * 0.9, 9);
    expect(s.slot.eduQ[1]).toBe(0); // no secondary school
    // Overcrowded: the school's coverage fades by the same 200/240.
    expect(s.slot.cov[COV.school][cellOf(tileIndex(20, 21))]).toBeCloseTo(70 * (200 / 240), 9);
  });

  it('counts health capacity in beds and quality as the mean strength over 85 (A14)', () => {
    const k = kitTown();
    road(k.t, 10, 20, 40, 20);
    place(k.t, 'windmill', 10, 21);
    place(k.t, 'surgery', 20, 21); // 2,500 people = 10 beds, health 45
    place(k.t, 'healthCentre', 30, 21); // 12,000 people = 48 beds, health 65
    const s = services(k);
    expect(s.slot.healthCap).toBeCloseTo(58, 12);
    expect(s.slot.healthQuality).toBeCloseTo((45 / 85 + 65 / 85) / 2, 12);
  });

  it('demands staff by tier: Hamlet-tier buildings hire £ only, others 30/50/20 (A2)', () => {
    const k = kitTown();
    road(k.t, 10, 20, 40, 20);
    place(k.t, 'schoolHouse', 20, 21); // tier 0, 3 staff
    place(k.t, 'constablePost', 22, 21); // tier 1, 6 staff
    place(k.t, 'townHall', 24, 21); // 4 + 1 per 500 residents
    zoneRect(k.t, 10, 22, 10, 1, 'homes', 5, 0);
    people(k.t, 0, 1100);
    const s = services(k);
    expect(s.slot.staffNeeded).toEqual([3, 6, 6]);
    expect(s.slot.staffDemand[0]).toBeCloseTo(3 + 6 * 0.3 + 6, 12);
    expect(s.slot.staffDemand[1]).toBeCloseTo(6 * 0.5, 12);
    expect(s.slot.staffDemand[2]).toBeCloseTo(6 * 0.2, 12);
  });

  it('flags a town-wide Fun venue and measures the library share of homes', () => {
    const k = kitTown();
    road(k.t, 10, 20, 60, 20);
    place(k.t, 'windmill', 10, 21);
    place(k.t, 'library', 12, 21); // radius 14 tiles = 7 cells
    zoneRect(k.t, 12, 22, 2, 1, 'homes', 1, 0); // inside
    zoneRect(k.t, 55, 21, 2, 1, 'homes', 1, 0); // far outside
    people(k.t, 0, 32);
    let s = services(k);
    expect(s.slot.libraryShare).toBeCloseTo(0.5, 9);
    expect(s.slot.funVenue).toBe(false);
    place(k.t, 'cinema', 30, 21);
    s = services(k);
    expect(s.slot.funVenue).toBe(true);
  });
});

describe('nature', () => {
  it('blurs tree, water and park tiles over three cells with linear falloff', () => {
    const w = new Float64Array(CELLS);
    w[cell(10, 10)] = 12;
    const out = diamondBlur(w, 3);
    expect(out[cell(10, 10)]).toBe(12);
    expect(out[cell(11, 10)]).toBeCloseTo(12 * 0.75, 12);
    expect(out[cell(11, 12)]).toBeCloseTo(12 * 0.25, 12);
    expect(out[cell(12, 12)]).toBe(0);
    // Mass check: Σ weights over the diamond = 1 + 4·0.75 + 8·0.5 + 12·0.25.
    let s = 0;
    for (let c = 0; c < CELLS; c++) s += out[c];
    expect(s).toBeCloseTo(12 * (1 + 3 + 4 + 3), 9);
  });

  it('adds parks to nature coverage', () => {
    const k = kitTown();
    road(k.t, 10, 20, 40, 20);
    place(k.t, 'windmill', 10, 21);
    const before = services(k).slot.cov[COV.nature][cellOf(tileIndex(20, 21))];
    place(k.t, 'pocketPark', 20, 21); // one park tile: +15 in its cell, plus its own Nature 15
    const after = services(k).slot.cov[COV.nature][cellOf(tileIndex(20, 21))];
    expect(after - before).toBeCloseTo(15 + 15, 9);
  });
});
