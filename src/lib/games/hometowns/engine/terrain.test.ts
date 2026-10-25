import { describe, expect, it } from 'vitest';
import { hashOf } from './hash';
import {
  COUNTY_ROAD_END_Y,
  COUNTY_ROAD_X,
  T_WATER,
  TF_COAST,
  TF_RIVER,
  applyTerrainEdits,
  buildable,
  fairSites,
  generateTerrain,
  siteKindsFor,
  terrainKind,
  terrainStats,
  T_GRASS,
  T_FOREST,
} from './terrain';
import { MAP, tileIndex } from './tiles';
import { SITE_KINDS } from './types';

describe('terrain', () => {
  it('is deterministic per seed and kind, and differs between seeds', () => {
    for (const kind of SITE_KINDS) {
      expect(hashOf([...generateTerrain(7, kind)])).toBe(hashOf([...generateTerrain(7, kind)]));
      expect(hashOf([...generateTerrain(7, kind)])).not.toBe(hashOf([...generateTerrain(8, kind)]));
    }
  });

  it('keeps the County Road and signpost corridors buildable on every site', () => {
    for (const kind of SITE_KINDS)
      for (let seed = 0; seed < 20; seed++) {
        const t = generateTerrain(seed, kind);
        for (let y = COUNTY_ROAD_END_Y; y < MAP; y++) expect(buildable(t[tileIndex(COUNTY_ROAD_X, y)])).toBe(true);
        for (let x = 0; x < 4; x++) expect(buildable(t[tileIndex(x, 32)])).toBe(true);
        for (let x = MAP - 4; x < MAP; x++) expect(buildable(t[tileIndex(x, 32)])).toBe(true);
      }
  });

  it('gives each site kind its feature', () => {
    const river = terrainStats(generateTerrain(3, 'river'));
    expect(river.kinds[T_WATER]).toBeGreaterThan(100);
    expect(river.river).toBeGreaterThan(river.kinds[T_WATER]);
    const coast = terrainStats(generateTerrain(3, 'coast'));
    expect(coast.coast).toBeGreaterThan(500);
    const forest = terrainStats(generateTerrain(3, 'forest'));
    const flat = terrainStats(generateTerrain(3, 'flatland'));
    expect(forest.kinds[T_FOREST]).toBeGreaterThan(flat.kinds[T_FOREST]);
    expect(terrainStats(generateTerrain(3, 'hills')).kinds[4]).toBeGreaterThan(100);
    // Every site leaves most of the map buildable.
    for (const k of SITE_KINDS) expect(terrainStats(generateTerrain(11, k)).buildable).toBeGreaterThan(2500);
    expect(TF_COAST & TF_RIVER).toBe(0);
  });

  it('applies edits on top of the generated plane', () => {
    const t = generateTerrain(5, 'forest');
    const tile = t.findIndex((v) => terrainKind(v) === T_FOREST);
    applyTerrainEdits(t, [tile, T_GRASS]);
    expect(terrainKind(t[tile])).toBe(T_GRASS);
  });

  it('assigns every site kind at least once in a county', () => {
    for (let seed = 0; seed < 10; seed++) {
      const kinds = siteKindsFor(seed);
      expect(kinds).toHaveLength(6);
      for (const k of SITE_KINDS) expect(kinds).toContain(k);
    }
  });

  it('the fairness hook accepts a best site within 1.15× of the worst', () => {
    expect(fairSites([100, 110, 114])).toBe(true);
    expect(fairSites([100, 120])).toBe(false);
    expect(fairSites([0, 1])).toBe(false);
  });
});
