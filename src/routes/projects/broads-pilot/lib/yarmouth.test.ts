// Integration regression test for the Great Yarmouth Yacht Station topology fix
// (split-yarmouth.ts). Loads the REAL bundled datasets and asserts that a
// >2.06 m boat can reach the Yacht Station from the north (it sits UPSTREAM of
// the low Yarmouth bridges) while the through-route to the south across Breydon
// stays gated by those bridges. Before the fix the Yacht Station snapped to the
// Bure/Yare confluence BELOW the bridges, so this would block at Vauxhall.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { route } from '$lib/broads-pilot/router';
import type { WaterGraph, Restrictions, Boat, Mooring } from '$lib/broads-pilot/types';

const load = <T>(f: string): T =>
  JSON.parse(readFileSync(join(process.cwd(), 'static/broads-pilot', f), 'utf8')) as T;

const graph = load<WaterGraph>('graph.json');
const restrictions = load<Restrictions>('restrictions.json');
const fleet = load<Boat[]>('fleet.json');
const moorings = load<Mooring[]>('moorings.json');

const sunrise = fleet.find((b) => b.slug === 'broads-sunrise')!;
const dayboat = fleet.find((b) => b.slug === 'electric-day-boat-6')!;
const yachtStation = moorings.find((m) => /yarmouth.*yacht station/i.test(m.name))!;
const burghCastle = moorings.find((m) => /burgh castle/i.test(m.name))!;
const STALHAM = 'staithe-stalham';

describe('Great Yarmouth Yacht Station reachability (split-yarmouth fix)', () => {
  it('the Yacht Station mooring snaps to a node above the bridges', () => {
    expect(yachtStation.node_id).toBe('n-ys-yarmouth');
  });

  it('a 2.18 m boat (Broads Sunrise) CAN reach the Yacht Station from Stalham', () => {
    const r = route(graph, restrictions, sunrise, STALHAM, yachtStation.node_id!);
    expect(r.edges.length).toBeGreaterThan(0); // reachable
    expect(r.blockedAt).toBeFalsy();
    // the binding bridge on the way down is Ludham, which it clears
    expect(r.bridges.every((b) => b.verdict !== 'blocked')).toBe(true);
  });

  it('the through-route SOUTH across Breydon stays gated for a 2.18 m boat', () => {
    const r = route(graph, restrictions, sunrise, STALHAM, burghCastle.node_id!);
    expect(r.edges.length).toBe(0); // not reachable
    expect(r.blockedAt?.id).toMatch(/yarmouth-(vauxhall|acle-road)/);
  });

  it('a low day boat (1.45 m) CAN make the full through-route across Breydon', () => {
    const r = route(graph, restrictions, dayboat, STALHAM, burghCastle.node_id!);
    expect(r.edges.length).toBeGreaterThan(0);
    expect(r.blockedAt).toBeFalsy();
  });
});
