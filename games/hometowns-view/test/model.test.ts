// The render-model mapping (spec §12.2): what each tile and building is drawn
// as, the time-lapse mask and the hover text, checked on a freshly founded
// town without Pixi or a DOM.

import { describe, expect, it } from 'vitest';
import { HarnessSession } from '../src/harness/session';
import { COUNTY_ROAD_END_Y, COUNTY_ROAD_X, MAP, TILES, paramsFor, tileIndex } from '../src/engine';
import { lensData } from '../src/lenses';
import { MASK_LOT, MASK_SHOWN, MASK_TERRAIN, RAIL_TILE, buildingRects, describeTile, groundColour, mapModel } from '../src/render/model';
import { chunkSignatures, links, project, unproject } from '../src/render/map';
import { E, N, S, W } from '../src/render/art';
import { LENS_RAMP, LOCKED_SHADE, ROADS, TERRAIN, ZONE_LOT, grey, mix, shade } from '../src/render/palette';

describe('palette arithmetic', () => {
  it('shades, mixes and greys within 0..255 per channel', () => {
    expect(shade(0x808080, 2)).toBe(0xffffff);
    expect(shade(0x808080, 0)).toBe(0x000000);
    expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    const g = grey(0xff0000);
    expect((g >> 16) & 255).toBe(g & 255);
  });
  it('has a five-step lens ramp that gets lighter at every step (colour-blind safe ordering)', () => {
    const light = (c: number) => 0.3 * ((c >> 16) & 255) + 0.59 * ((c >> 8) & 255) + 0.11 * (c & 255);
    expect(LENS_RAMP).toHaveLength(5);
    for (let k = 1; k < 5; k++) expect(light(LENS_RAMP[k])).toBeGreaterThan(light(LENS_RAMP[k - 1]));
  });
});

describe('projection', () => {
  it('maps tile corners to 2:1 isometric and back, and top-down squares and back', () => {
    for (const p of ['iso', 'top'] as const)
      for (const [x, y] of [[0, 0], [10, 3], [63, 63], [32.5, 46.25]]) {
        const [wx, wy] = project(p, x, y);
        const [gx, gy] = unproject(p, wx, wy);
        expect(gx).toBeCloseTo(x, 9);
        expect(gy).toBeCloseTo(y, 9);
      }
    // A tile diamond is twice as wide as it is tall.
    const [ax, ay] = project('iso', 0, 0);
    const [bx, by] = project('iso', 1, 0);
    expect(Math.abs(bx - ax)).toBe(2 * Math.abs(by - ay));
  });
});

describe('mapModel on a founded town', () => {
  const s = new HarnessSession({ seed: 3 });
  const t = s.town;

  it('draws the County Road and the Town Hall where founding put them', () => {
    expect(groundColour(t, tileIndex(COUNTY_ROAD_X, MAP - 1))).toBe(ROADS.county);
    expect(groundColour(t, tileIndex(COUNTY_ROAD_X, COUNTY_ROAD_END_Y))).toBe(ROADS.county);
    const hall = buildingRects(t).find((b) => b.id === 'townHall');
    expect(hall).toMatchObject({ x: 33, y: 44, w: 2, h: 2, building: 0 });
  });

  it('draws the founding lane, the zoned lots and the well under construction', () => {
    const m = mapModel(t);
    expect([...m.ground].filter((c) => c === ZONE_LOT[0]).length).toBe(12);
    expect([...m.ground].filter((c) => c === ZONE_LOT[5]).length).toBe(2);
    expect([...m.ground].filter((c) => c === ROADS.lane).length).toBeGreaterThanOrEqual(3); // a segment may share tiles with the County Road
    expect(m.buildings.find((b) => b.id === 'well')?.building).toBeGreaterThan(0);
  });

  it('darkens locked parcels but not the County Road through them', () => {
    // (0, 0) is in a corner parcel, locked at founding.
    expect(TERRAIN.map((g) => shade(g, LOCKED_SHADE))).toContain(groundColour(t, tileIndex(0, 0)));
    expect(groundColour(t, tileIndex(COUNTY_ROAD_X, 60))).toBe(ROADS.county);
  });

  it('greys the map under a lens and lays its steps over it', () => {
    const plain = mapModel(t);
    const lens = lensData('landValue', t, null, paramsFor('v1'));
    const m = mapModel(t, lens);
    expect([...m.lens].every((v) => v <= 4)).toBe(true);
    expect(m.ground[tileIndex(0, 0)]).not.toBe(plain.ground[tileIndex(0, 0)]);
    expect(m.buildings.every((b) => ((b.colour >> 16) & 255) === (b.colour & 255))).toBe(true);
  });

  it('hides what the time-lapse has not reached: terrain, a bare lot, or the building', () => {
    const lots = [];
    for (let i = 0; i < TILES; i++) if (mapModel(t).ground[i] === ZONE_LOT[0]) lots.push(i);
    const mask = new Uint8Array(TILES);
    mask[lots[0]] = MASK_TERRAIN;
    mask[lots[1]] = MASK_LOT;
    const hall = tileIndex(33, 44);
    mask[hall] = MASK_TERRAIN;
    const m = mapModel(t, null, mask);
    expect(TERRAIN).toContain(m.ground[lots[0]]);
    expect(m.ground[lots[1]]).toBe(ZONE_LOT[0]);
    expect(m.buildings.some((b) => b.id === 'townHall')).toBe(false);
    expect(mask[lots[2]]).toBe(MASK_SHOWN);
  });

  it('describes tiles for the hover readout', () => {
    expect(describeTile(t, COUNTY_ROAD_X, 50)).toBe(`(${COUNTY_ROAD_X}, 50) county road`);
    expect(describeTile(t, 33, 44)).toContain('Town Hall');
    expect(describeTile(t, 0, 0)).toBe('(0, 0) locked land');
  });

  it('changes a chunk signature only where the town changed', () => {
    const before = chunkSignatures(mapModel(t));
    expect(chunkSignatures(mapModel(t))).toEqual(before);
    s.runDays(1);
    const after = chunkSignatures(mapModel(t));
    expect(after).not.toEqual(before);
    // Far corners never change in a day-old hamlet (locked land).
    expect(after[0]).toBe(before[0]);
  });

  it('shows built blocks once the town develops', () => {
    const m = mapModel(t);
    expect([...m.level].filter((v) => v > 0).length).toBeGreaterThan(0);
    for (let i = 0; i < m.level.length; i++) if (m.level[i] > 0) expect(m.block[i]).toBeGreaterThan(0);
  });
});

describe('what the painter dresses each tile as', () => {
  const s = new HarnessSession({ seed: 3 });
  const t = s.town;
  const m = mapModel(t);

  it('marks the County Road as a county road that runs north and south', () => {
    const i = tileIndex(COUNTY_ROAD_X, 60);
    expect(m.road[i]).toBe(4);
    expect(m.road[i]).not.toBe(RAIL_TILE);
    expect(links(m, COUNTY_ROAD_X, 60) & (N | S)).toBe(N | S);
    expect(links(m, COUNTY_ROAD_X, 60) & (E | W)).toBe(0);
  });

  it('marks zoned lots, the Town Hall footprint and the terrain under everything else', () => {
    expect([...m.zone].filter((z) => z === 1).length).toBe(12);
    expect(m.built[tileIndex(33, 44)]).toBe(1);
    expect(m.built[tileIndex(34, 45)]).toBe(1);
    expect(m.zone[tileIndex(33, 44)]).toBe(0);
    expect([...m.terrain].every((k) => k <= 5)).toBe(true);
    expect(m.lensOn).toBe(false);
    expect(mapModel(t, lensData('landValue', t, null, paramsFor('v1'))).lensOn).toBe(true);
  });

  it('hides roads and zones the time-lapse has not reached', () => {
    const mask = new Uint8Array(TILES).fill(MASK_TERRAIN);
    const hidden = mapModel(t, null, mask);
    expect([...hidden.road].every((v) => v === 0)).toBe(true);
    expect([...hidden.zone].every((v) => v === 0)).toBe(true);
  });
});

