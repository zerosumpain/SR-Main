// The render-model mapping (spec §12.2): what each tile and building is drawn
// as, the lens steps and the inspector text, checked on a freshly founded
// town without Pixi or a DOM.

import { describe, expect, it } from 'vitest';
import { HarnessSession } from '../src/harness/session';
import { COUNTY_ROAD_END_Y, COUNTY_ROAD_X, MAP, tileIndex } from '../src/engine';
import { buildingRects, cellValue, describeTile, groundColour, LENS_DEFS, LENSES, mapModel, step5 } from '../src/render/model';
import { LENS_RAMP, LOCKED_SHADE, ROADS, TERRAIN, ZONE_LOT, grey, mix, shade } from '../src/render/palette';
import { paintKey } from '../src/render/map';

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

describe('step5', () => {
  it('puts values into five steps by thresholds', () => {
    const th = [40, 70, 100, 140];
    expect([0, 39, 40, 69, 70, 100, 139, 140, 250].map((v) => step5(v, th))).toEqual([0, 0, 1, 1, 2, 3, 3, 4, 4]);
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
    const lots = [...m.ground].filter((c) => c === ZONE_LOT[0]).length;
    expect(lots).toBe(12);
    expect([...m.ground].filter((c) => c === ZONE_LOT[5]).length).toBe(2);
    expect([...m.ground].filter((c) => c === ROADS.lane).length).toBeGreaterThanOrEqual(3); // a segment may share tiles with the County Road
    const well = m.buildings.find((b) => b.id === 'well');
    expect(well?.building).toBeGreaterThan(0);
  });

  it('darkens locked parcels but not the County Road through them', () => {
    // (0, 0) is in a corner parcel, locked at founding.
    const c = groundColour(t, tileIndex(0, 0));
    expect(TERRAIN.map((g) => shade(g, LOCKED_SHADE))).toContain(c);
    expect(groundColour(t, tileIndex(COUNTY_ROAD_X, 60))).toBe(ROADS.county);
  });

  it('greys the map under a lens and marks every tile with a step', () => {
    for (const lens of LENSES) {
      const m = mapModel(t, lens);
      if (lens === 'none') {
        expect([...m.lens].every((v) => v === 255)).toBe(true);
        continue;
      }
      expect([...m.lens].some((v) => v !== 255)).toBe(true);
      expect([...m.lens].every((v) => v === 255 || v <= 4)).toBe(true);
      expect(LENS_DEFS[lens].legend).toHaveLength(5);
    }
    // Land value covers every tile (it is a 32×32 field); access only open land.
    expect([...mapModel(t, 'landValue').lens].every((v) => v <= 4)).toBe(true);
    const access = mapModel(t, 'access').lens;
    expect(access[tileIndex(0, 0)]).toBe(255);
    expect(access[tileIndex(31, 47)]).toBe(4);
  });

  it('describes tiles for the inspector', () => {
    expect(describeTile(t, COUNTY_ROAD_X, 50)).toBe(`(${COUNTY_ROAD_X}, 50) county road`);
    expect(describeTile(t, 33, 44)).toContain('Town Hall');
    expect(describeTile(t, 0, 0)).toBe('(0, 0) locked land');
    expect(cellValue(t, 'landValue', 32, 40)).toBeGreaterThanOrEqual(1);
    expect(cellValue(t, 'none', 32, 40)).toBeNull();
  });

  it('changes the paint key when the town or the lens changes, and only then', () => {
    const before = paintKey(t, 'none');
    expect(paintKey(t, 'none')).toBe(before);
    expect(paintKey(t, 'landValue')).not.toBe(before);
    s.runDays(1);
    expect(paintKey(t, 'none')).not.toBe(before);
  });

  it('shows built blocks once the town develops', () => {
    const m = mapModel(t);
    const built = [...m.level].filter((v) => v > 0).length;
    expect(built).toBeGreaterThan(0);
    for (let i = 0; i < m.level.length; i++) if (m.level[i] > 0) expect(m.block[i]).toBeGreaterThan(0);
  });
});
