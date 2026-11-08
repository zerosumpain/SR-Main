// WP2b stars and needs (spec §5.6, §5.15 U_happy with A13, A10): star
// fixtures, the needs ladders, perception, the culture stock.

import { describe, expect, it } from 'vitest';
import { fixture } from '../../../../../scripts/hometowns/fixture';
import { monthContext } from '../../../../../scripts/hometowns/people-kit';
import { buildingIndex } from './content';
import { neutral } from './derived';
import { T } from './fx';
import { NEED_ITEMS, ladder, stepStars, taxStar, townNeeds, townStars } from './needs';
import { paramsFor } from './params';
import { TILES, newBuilding } from './tiles';
import { STARS, STAR_COUNT, starTier } from './types';

const P = paramsFor('v1');
const m0 = { params: P };

describe('the Tax star (§5.6)', () => {
  it('falls 6.5 a point of homes tax above 3%, scaled by each tier’s sensitivity', () => {
    expect(taxStar(800, 1, m0)).toBeCloseTo(67.5, 12);
    expect(taxStar(800, 1.3, m0)).toBeCloseTo(100 - 6.5 * 5 * 1.3, 12);
    expect(taxStar(300, 0.8, m0)).toBe(100);
    expect(taxStar(2000, 1.3, m0)).toBe(0);
  });
});

describe('Jobs and Homes stars (§5.6)', () => {
  it('residents feel unemployment; movers weigh vacancies against the queue', () => {
    const f = fixture('town');
    const t = f.county.towns[f.town];
    const labour = { ...neutral.labour(), workforce: [100, 100, 100], unemployed: [10, 0, 30], vacancies: [0, 20, 0] };
    const housing = { ...neutral.housing(), afford: [80, 60, 90], vacant: [0, 50, 10], cap: [1000, 1000, 1000] };
    const s = townStars(t, monthContext(f.county, f.town, { labour, housing }));
    expect([0, 1, 2].map((h) => s.actual[starTier(0, h)])).toEqual([50, 100, 0]);
    expect(s.movers[starTier(0, 0)]).toBeCloseTo(50 + 50 * T(-10 / 25), 12);
    expect(s.movers[starTier(0, 1)]).toBeCloseTo(50 + 50 * T(20 / 25), 12);
    // Homes: Afford · (0.5 + 0.5·min(1, Vacant/(0.03·Cap + 5))).
    expect(s.actual[starTier(1, 0)]).toBeCloseTo(40, 12);
    expect(s.actual[starTier(1, 1)]).toBeCloseTo(60, 12);
    expect(s.actual[starTier(1, 2)]).toBeCloseTo(90 * (0.5 + 0.5 * (10 / 35)), 12);
    for (const x of s.actual) expect(x >= 0 && x <= 100).toBe(true);
    expect(s.actual).toHaveLength(STAR_COUNT);
  });
});

describe('needs ladders (§5.6, A10)', () => {
  it('are cumulative: £ ⊂ ££ ⊂ £££', () => {
    expect(ladder(0).length).toBeLessThan(ladder(1).length);
    expect(ladder(1).length).toBeLessThan(ladder(2).length);
    expect(ladder(2)).toHaveLength(NEED_ITEMS.length);
    for (const i of ladder(0)) expect(ladder(1)).toContain(i);
  });

  it('count an item met for under half a tier’s residents as unmet, and ignore what cannot be built yet', () => {
    const f = fixture('hamlet');
    const t = f.county.towns[f.town];
    const wet = neutral.utilities();
    const dry = { ...neutral.utilities(), watered: new Uint8Array(TILES) };
    const water = NEED_ITEMS.findIndex((i) => i.id === 'water');
    const power = NEED_ITEMS.findIndex((i) => i.id === 'power');
    const a = townNeeds(t, monthContext(f.county, f.town, { utilities: wet }));
    const b = townNeeds(t, monthContext(f.county, f.town, { utilities: dry }));
    expect(a.items[0][water]).toBe(1);
    expect(b.items[0][water]).toBe(0);
    expect(b.unmet[0]).toBe(a.unmet[0] + 1);
    expect(b.tier[0]).toBeLessThan(a.tier[0]);
    // A hamlet cannot build power yet (Village+), so it counts as met.
    const unpowered = { ...neutral.utilities(), powered: new Uint8Array(TILES) };
    expect(townNeeds(t, monthContext(f.county, f.town, { utilities: unpowered })).items[0][power]).toBe(1);
  });

  it('give Families, not Workers, the school-place items', () => {
    const f = fixture('hamlet');
    const t = f.county.towns[f.town];
    t.buildings = t.buildings.filter((b) => b[0] !== buildingIndex('schoolHouse'));
    const n = townNeeds(t, monthContext(f.county, f.town, {}));
    const primary = NEED_ITEMS.findIndex((i) => i.id === 'primary');
    expect(n.items[0][primary]).toBe(0);
    expect(n.cohort[1]).toBeLessThan(n.cohort[0]); // £ Families miss the school; £ Workers do not care
  });
});

describe('perception, culture and U_happy (§5.6, §5.15)', () => {
  it('starts perceived stars at the truth (A11), then smooths them with τ 6', () => {
    const f = fixture('town');
    const t = f.county.towns[f.town];
    t.tick = 3;
    const m = monthContext(f.county, f.town, {});
    stepStars(t, m);
    const first = [...t.perceived];
    const truth = townStars(t, m).movers;
    first.forEach((x, k) => expect(x).toBeCloseTo(truth[k], 9));
    t.tick = 7;
    const was = [...t.perceived];
    t.perceived = t.perceived.map(() => 20);
    const m2 = monthContext(f.county, f.town, {});
    stepStars(t, m2);
    const now = townStars(t, m2).movers;
    t.perceived.forEach((x, k) => expect(x).toBeCloseTo(20 + (now[k] - 20) / 6, 9));
    expect(was).not.toEqual(t.perceived);
  });

  it('fills the culture stock from venues and drains it with τ 36', () => {
    const f = fixture('hamlet');
    const t = f.county.towns[f.town];
    t.buildings = [newBuilding(buildingIndex('museum'), 10, 10, 0, 0, 1)];
    t.culture = 0;
    stepStars(t, monthContext(f.county, f.town, {}));
    expect(t.culture).toBeCloseTo(4, 12); // a museum at Normal funding; an all-£ hamlet has no Diversity yet
    t.culture = 360;
    t.buildings = [];
    stepStars(t, monthContext(f.county, f.town, {}));
    expect(t.culture).toBeCloseTo(350, 12);
  });

  it('makes homes tax felt by every cohort (A13: Tax weight at least 0.6 in U_happy)', () => {
    const f = fixture('town');
    const t = f.county.towns[f.town];
    const culture = t.culture;
    const at = (bp: number) => {
      t.taxes.homes = [bp, bp, bp];
      t.culture = culture; // the step also moves the culture stock; hold it so only the tax differs
      const m = monthContext(f.county, f.town, {});
      stepStars(t, m);
      return m.derived.stars!.uHappy;
    };
    const low = at(800);
    const high = at(1600);
    // £ Workers' migration Tax weight is 0.2; in U_happy it counts 0.6: 0.6 × (6.5 × 8 × 0.8) / 50.
    expect(low[0] - high[0]).toBeCloseTo((0.6 * 6.5 * 8 * 0.8) / 50, 9);
    // £££ Retirees already weigh it 1.6; their Tax star goes from 57.75 to 0 (clamped).
    expect(low[8] - high[8]).toBeCloseTo((1.6 * (100 - 6.5 * 5 * 1.3)) / 50, 9);
  });

  it('keeps every star in 0–100 on the golden fixtures', () => {
    for (const kind of ['hamlet', 'town', 'metropolis'] as const) {
      const f = fixture(kind);
      const t = f.county.towns[f.town];
      const m = monthContext(f.county, f.town, {});
      stepStars(t, m);
      expect(m.derived.stars!.actual.every((x) => x >= 0 && x <= 100)).toBe(true);
      expect(t.perceived.every((x) => x >= 0 && x <= 100)).toBe(true);
      expect(m.derived.needs!.cohort.every((x) => x >= 0 && x <= 1)).toBe(true);
      expect(STARS).toHaveLength(11);
    }
  });
});
