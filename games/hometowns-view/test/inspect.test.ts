// The inspector card (spec §9.5) and "What would make it grow?": the
// suggested plan is one the engine accepts.

import { describe, expect, it } from 'vitest';
import { fixture } from '../../../scripts/hometowns/fixture';
import { CAT_ROAD, CAT_ZONE, COUNTY_ROAD_X, MAP, applyBuild, commitTown, gridEndAt, paramsFor, planesOf, roadAccess, useCat, type TownState } from '../src/engine';
import { inspectTile } from '../src/inspect';
import { readSpace } from '../src/lenses';
import { previewPlan } from '../src/plan/plan';

describe('inspectTile', () => {
  const f = fixture('town');
  const c = f.county;
  const t = c.towns[f.town];
  const params = paramsFor(c.paramsVersion);
  const env = { params, dayIndex: c.dayIndex, profile: 'adult' as const };
  const space = readSpace(t, { env: { params, snapshot: c.snapshot, rivalry: c.settings.rivalry, mishaps: c.settings.mishaps, dayIndex: c.dayIndex }, townIndex: f.town, at: gridEndAt(c, c.gridTick - 1) });
  const input = (town: TownState) => ({ t: town, space, params, derived: null, env });

  it('describes a road, locked land and a built zone tile', () => {
    expect(inspectTile(COUNTY_ROAD_X, MAP - 1, input(t))).toMatchObject({ kind: 'road', title: 'County road' });
    const locked = inspectTile(0, 0, input(t));
    expect(['locked', 'land']).toContain(locked.kind);
    const p = planesOf(t);
    const i = p.use.findIndex((u, k) => useCat(u) === CAT_ZONE && (p.lvl[k] & 7) > 0);
    const card = inspectTile(i % MAP, Math.floor(i / MAP), input(t));
    expect(card.kind).toBe('zone');
    expect(card.level).toBeGreaterThan(0);
    expect(card.who).toMatch(/^(Home to about|About) /);
    expect(card.grow).not.toBeNull();
    expect(card.landValue?.terms.length).toBeLessThanOrEqual(3);
  });

  it('offers a lane the engine accepts for a zoned lot with no road near it', () => {
    // Zone a lot far from any road on a copy, then ask what would make it grow.
    const copy = JSON.parse(JSON.stringify(t)) as TownState;
    const reach = roadAccess(copy);
    const p = planesOf(copy);
    let spot = -1;
    for (let y = 18; y < 46 && spot < 0; y++)
      for (let x = 18; x < 46; x++) {
        const k = y * MAP + x;
        if (!reach[k] && p.use[k] === 0) {
          try {
            applyBuild(copy, 'z', [{ op: 'zone', zone: 'homes', rect: [x, y, 1, 1] }], env);
            commitTown(copy);
            if (useCat(planesOf(copy).use[k]) === CAT_ZONE) spot = k;
          } catch {
            // Not zonable here; try the next tile.
          }
          break;
        }
      }
    expect(spot).toBeGreaterThanOrEqual(0);
    const card = inspectTile(spot % MAP, Math.floor(spot / MAP), input(copy));
    expect(card.grow?.blocked).toBe('noRoad');
    expect(card.growLine).toMatch(/road/);
    expect(card.growPlan).not.toBeNull();
    if (card.growPlan) {
      expect(card.growPlan[0].op).toBe('road');
      expect(previewPlan(copy, card.growPlan, env).refused).toBeNull();
      const after = JSON.parse(JSON.stringify(copy)) as TownState;
      applyBuild(after, 'g', card.growPlan, env);
      expect(useCat(planesOf(after).use[spot])).toBe(CAT_ZONE);
      expect([...planesOf(after).use].filter((u) => useCat(u) === CAT_ROAD).length).toBeGreaterThan([...p.use].filter((u) => useCat(u) === CAT_ROAD).length);
    }
  });
});
