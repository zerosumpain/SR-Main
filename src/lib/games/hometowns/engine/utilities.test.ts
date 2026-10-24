// M2 Utilities (§3.5, §5.14): grids are road components, brownouts cut in a
// fixed order, Kingsport fills (and buys) over the County Road.

import { describe, expect, it } from 'vitest';
import { kitTown, monthOf, people, place, road, zone, zoneRect, type Kit } from '../../../../../scripts/hometowns/space-kit';
import { paramsFor } from './params';
import { runFor } from './space';
import { SIGNPOST_KINGSPORT } from './terrain';
import { tileIndex, tileX, tileY } from './tiles';
import { stepUtilities, utilitiesOf } from './utilities';
import type { UtilitiesSlot } from './types';

const P = paramsFor('v1');

function serve(k: Kit, event: string | null = null): UtilitiesSlot {
  const m = monthOf(k);
  if (event) (m as { world: unknown }).world = { ...m.world, event: { id: event, fromMonth: 0, toMonth: 99 } };
  return utilitiesOf(runFor(k.t, m, m.derived));
}

/** An island street (no County Road) with a Windmill and a Well at its west end. */
function island(): Kit {
  const k = kitTown({ tier: 0 });
  road(k.t, 10, 10, 40, 10);
  place(k.t, 'windmill', 10, 11); // 300 power points
  place(k.t, 'well', 11, 11); // 300 water units
  return k;
}

describe('grids and brownouts', () => {
  it('serves everything when supply covers demand', () => {
    const k = island();
    zoneRect(k.t, 14, 11, 10, 1, 'homes', 1, 0); // 80 persons of capacity
    people(k.t, 0, 80);
    const u = serve(k);
    expect(u.powerSupply).toBe(300);
    expect(u.powerDemand).toBeCloseTo(80, 9);
    expect(u.cutTiles).toBe(0);
    expect(u.powered[tileIndex(14, 11)]).toBe(1);
    expect(u.watered[tileIndex(23, 11)]).toBe(1);
    expect(u.poweredShare).toBe(1);
    expect(u.powerImported).toBe(0);
  });

  it('cuts Industry, then Shops, Leisure and Farms, then Offices, then the farthest Homes (§3.5)', () => {
    const k = island();
    const ind = zone(k.t, 30, 11, 'industry', 1); // 6 jobs × 3 = 18 points
    const shop = zone(k.t, 31, 11, 'shops', 1); // 3 points
    const office = zone(k.t, 32, 11, 'offices', 3); // 60 points
    zoneRect(k.t, 14, 11, 10, 1, 'homes', 1, 0); // x 14–23
    zoneRect(k.t, 14, 9, 22, 1, 'homes', 1, 0); // x 14–35, north side
    // 32 home tiles × 8 = 256 residents → 256 + 18 + 3 + 60 = 337 points against 300.
    people(k.t, 0, 256);
    let u = serve(k);
    expect(u.powerDemand).toBeCloseTo(337, 9);
    expect(u.powered[ind]).toBe(0);
    expect(u.powered[shop]).toBe(0);
    expect(u.powered[office]).toBe(0); // 37 short: Industry (18) and Shops (3) are not enough, so Offices go
    expect(u.powered[tileIndex(35, 9)]).toBe(1); // and every home keeps its power
    expect(u.cutTiles).toBe(3);
    // Water: 256 + 0.5·(3 + 60) + 1.5·6 = 296.5 units against 300: nothing cut.
    expect(u.waterDemand).toBeCloseTo(296.5, 9);
    expect(u.watered[ind]).toBe(1);
    // 320 residents (10 a cottage): 101 short, 81 from the businesses, then the two farthest cottages.
    people(k.t, 0, 320);
    u = serve(k);
    expect(u.powered[tileIndex(35, 9)]).toBe(0);
    expect(u.powered[tileIndex(34, 9)]).toBe(0);
    expect(u.powered[tileIndex(33, 9)]).toBe(1);
    expect(u.powered[tileIndex(14, 11)]).toBe(1);
    expect(u.cutTiles).toBeGreaterThanOrEqual(5);
  });

  it('leaves a component without a plant dark, and a plant off the road serves nobody', () => {
    const k = island();
    road(k.t, 50, 30, 60, 30); // a second street, no plant
    const far = zone(k.t, 52, 31, 'homes', 1);
    zone(k.t, 14, 11, 'homes', 1);
    place(k.t, 'windmill', 50, 50); // nowhere near a road
    people(k.t, 0, 10);
    const u = serve(k);
    expect(u.powered[far]).toBe(0);
    expect(u.watered[far]).toBe(0);
    expect(u.powered[tileIndex(14, 11)]).toBe(1);
    expect(u.powerSupply).toBe(300); // the stranded windmill is not counted
    expect(u.poweredShare).toBeCloseTo(0.5, 12);
  });

  it('flags empty lots on a live grid (they would be served) and nothing on a dark one', () => {
    const k = island();
    const lot = zone(k.t, 20, 11, 'homes', 0);
    const u = serve(k);
    expect(u.powered[lot]).toBe(1);
    expect(u.powered[tileIndex(20, 13)]).toBe(0); // three tiles from the road: not attached
  });

  it('gives a damaged plant no output and a Wind Turbine ×1.3 on Hills', () => {
    const k = island();
    k.t.buildings[0][6] = 2; // the windmill is closed by an incident
    expect(serve(k).powerSupply).toBe(0);
    const h = kitTown({ site: 'hills', tier: 2 });
    road(h.t, 10, 10, 20, 10);
    place(h.t, 'windTurbine', 12, 11);
    expect(serve(h).powerSupply).toBeCloseTo(1500 * 1.3, 9);
  });

  it('raises power demand 15% during Cosy Winter', () => {
    const k = island();
    zoneRect(k.t, 14, 11, 5, 1, 'homes', 1, 0);
    people(k.t, 0, 40);
    expect(serve(k, 'cosyWinter').powerDemand).toBeCloseTo(40 * P.utilities.winterPower, 9);
    expect(serve(k, 'cosyWinter').waterDemand).toBeCloseTo(40, 9);
  });
});

/** A town whose street reaches the Kingsport signpost (the County Road's component). */
function countyRoadTown(tier: 0 | 1 | 2): Kit {
  const k = kitTown({ tier });
  const sx = tileX(SIGNPOST_KINGSPORT);
  const sy = tileY(SIGNPOST_KINGSPORT);
  road(k.t, sx, sy, sx, 40, 'avenue');
  road(k.t, 20, 40, sx, 40);
  return k;
}

describe('Kingsport trade over the County Road', () => {
  it('imports the shortfall from Village at £4.00 a point and £2.00 a unit, never cutting', () => {
    const k = countyRoadTown(1);
    zoneRect(k.t, 20, 41, 10, 1, 'homes', 1, 0);
    people(k.t, 0, 80);
    const u = serve(k);
    expect(u.powerImported).toBeCloseTo(80, 9);
    expect(u.waterImported).toBeCloseTo(80, 9);
    expect(u.importCost).toBeCloseTo(80 * 4 + 80 * 2, 9);
    expect(u.cutTiles).toBe(0);
    expect(u.powered[tileIndex(25, 41)]).toBe(1);
  });

  it('does not import in a Hamlet or with the standing order off', () => {
    const k = countyRoadTown(0);
    zoneRect(k.t, 20, 41, 3, 1, 'homes', 1, 0);
    people(k.t, 0, 24);
    expect(serve(k).powered[tileIndex(20, 41)]).toBe(0);
    const v = countyRoadTown(1);
    zoneRect(v.t, 20, 41, 3, 1, 'homes', 1, 0);
    people(v.t, 0, 24);
    v.t.orders = v.t.orders.map((o) => (o.kind === 'buyUtilities' ? { ...o, on: false } : o));
    const u = serve(v);
    expect(u.powerImported).toBe(0);
    expect(u.powered[tileIndex(20, 41)]).toBe(0);
  });

  it('sells the County Road grid’s surplus at £1.00 and £0.30 (A14)', () => {
    const k = countyRoadTown(1);
    place(k.t, 'windmill', 20, 41);
    place(k.t, 'well', 21, 41);
    zone(k.t, 23, 41, 'homes', 1);
    people(k.t, 0, 8);
    const u = serve(k);
    expect(u.powerExported).toBeCloseTo(292, 9);
    expect(u.waterExported).toBeCloseTo(292, 9);
    expect(u.exportIncome).toBeCloseTo(292 * 1 + 292 * 0.3, 9);
  });
});

describe('the step', () => {
  it('writes only derived.utilities, from stored state', () => {
    const k = island();
    const m = monthOf(k);
    const before = JSON.stringify(k.t);
    stepUtilities(k.t, m);
    expect(m.derived.utilities?.powerSupply).toBe(300);
    expect(JSON.stringify(k.t)).toBe(before);
  });
});
