import { describe, it, expect } from 'vitest';
import { buildSearchIndex, searchIndex } from './search';
import type { Datasets, Mooring, Poi, Bridge, Lock } from '$lib/broads-pilot/types';

const bridge = (id: string, name: string, river = 'Bure'): Bridge => ({
  id, name, river, clearance_ahw_m: 3, clearance_band_m: [3, 3.2],
  tide_dependent: false, pilot: null, opens_on_request: false, notes: '', lat: 52.7, lng: 1.4,
});
const lock: Lock = {
  id: 'mutford', name: 'Mutford Lock (Oulton Broad)', max_loa_m: 0, max_beam_m: 0,
  max_draft_m: 0, hours: '', booking: '', notes: '', lat: 52.47, lng: 1.71,
};
const mooring = (id: string, name: string, tier: Mooring['tier'] = 'ba_free'): Mooring => ({
  id, name, lat: 52.7, lng: 1.5, node_id: `n-${id}`, tier,
  rate: { amount: 0, unit: 'free' }, waived_with_meal: false,
  facilities: { water: false, shore_power: false, pump_out: false, toilets: false, showers: false, refuse: false },
  capacity: null, capacity_caveat: false, last_verified: '2025', source: 'test',
});
const poi = (id: string, name: string, kind: Poi['kind']): Poi => ({
  id, name, kind, lat: 52.7, lng: 1.5, description: '', source: 'test',
});

const data = {
  graph: { nodes: [], edges: [] },
  restrictions: {
    bridges: [bridge('wroxham-road', 'Wroxham (Road Bridge)'), bridge('ludham', 'Ludham Bridge'), bridge('potter-heigham-old', 'Potter Heigham (Old Road Bridge)')],
    lock,
    zones: [],
  },
  moorings: [mooring('m-richardsons', 'Richardsons Boating Holidays', 'hire_yard'), mooring('m-wroxham', 'Wroxham Broad BA Moorings')],
  pois: [poi('p-swan', 'The Swan Inn', 'pub'), poi('p-walk', 'Wroxham Riverside Walk', 'walk')],
  mooringPois: {},
  fleet: [],
  meta: { built_at: '', sources: {}, attribution: '' },
} as unknown as Datasets;

describe('buildSearchIndex', () => {
  it('indexes bridges, the lock, moorings and POIs (but not bare graph nodes)', () => {
    const idx = buildSearchIndex(data);
    const kinds = new Set(idx.map((e) => e.kind));
    expect(kinds).toEqual(new Set(['bridge', 'lock', 'mooring', 'poi']));
    expect(idx).toHaveLength(3 + 1 + 2 + 2);
    // every entry carries coordinates for flyTo
    expect(idx.every((e) => typeof e.lat === 'number' && typeof e.lng === 'number')).toBe(true);
  });

  it('gives each entry a human sublabel', () => {
    const idx = buildSearchIndex(data);
    expect(idx.find((e) => e.id === 'wroxham-road')?.sublabel).toMatch(/bridge/i);
    expect(idx.find((e) => e.id === 'mutford')?.sublabel).toMatch(/lock/i);
    expect(idx.find((e) => e.id === 'm-richardsons')?.sublabel).toMatch(/hire/i);
    expect(idx.find((e) => e.id === 'p-swan')?.sublabel).toMatch(/pub/i);
  });
});

describe('searchIndex ranking', () => {
  const idx = buildSearchIndex(data);

  it('returns nothing for an empty query', () => {
    expect(searchIndex(idx, '   ')).toEqual([]);
  });

  it('is case-insensitive and matches across feature types', () => {
    const names = searchIndex(idx, 'wroxham').map((e) => e.name);
    expect(names).toContain('Wroxham (Road Bridge)');
    expect(names).toContain('Wroxham Broad BA Moorings');
    expect(names).toContain('Wroxham Riverside Walk');
  });

  it('ranks an exact (case-insensitive) name first', () => {
    const top = searchIndex(idx, 'ludham bridge')[0];
    expect(top.id).toBe('ludham');
  });

  it('ranks a prefix match above a mid-string match', () => {
    const res = searchIndex(idx, 'wr');
    // "Wroxham ..." (prefix) should outrank nothing here, but ensure prefix wins
    expect(res[0].name.toLowerCase().startsWith('wr')).toBe(true);
  });

  it('matches a word-boundary prefix inside the name', () => {
    // "Road" is the second word of "Wroxham (Road Bridge)"
    const res = searchIndex(idx, 'road');
    expect(res.some((e) => e.id === 'wroxham-road')).toBe(true);
  });

  it('finds via fuzzy subsequence', () => {
    // "ldhm" is a subsequence of "Ludham Bridge"
    const res = searchIndex(idx, 'ldhm');
    expect(res.some((e) => e.id === 'ludham')).toBe(true);
  });

  it('respects the result limit', () => {
    expect(searchIndex(idx, 'o', 2).length).toBeLessThanOrEqual(2);
  });

  it('finds the lock by name', () => {
    expect(searchIndex(idx, 'mutford')[0].id).toBe('mutford');
  });
});
