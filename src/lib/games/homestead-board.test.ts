import { describe, expect, it } from 'vitest';
import {
  FALLBACK,
  ISLAND,
  RESOURCES,
  balanced,
  edgeEnds,
  generateIsland,
  geometry,
  harbourPositions,
  hexCorners,
  hexNeighbours,
  hexSides,
  islandCells,
  parseEdge,
  parseHex,
  parseVertex,
  pips,
  vertexEdges,
  vertexHexes,
  vertexNeighbours,
  vertexPoint,
  type IslandSize,
} from './homestead-board';
import { nextFloat, seedRng } from './homestead';

const SIZES: IslandSize[] = ['standard', 'large'];
const seeded = (seed: number) => {
  const s = seedRng(seed);
  return () => nextFloat(s);
};
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-9;

describe('coordinates', () => {
  it('formats canonically and parses only well-formed ids', () => {
    expect(parseHex('0,0')).toEqual({ q: 0, r: 0 });
    expect(parseHex('-2,1')).toEqual({ q: -2, r: 1 });
    expect(parseVertex('1,-1,N')).toEqual({ q: 1, r: -1, d: 'N' });
    expect(parseEdge('0,2,W')).toEqual({ q: 0, r: 2, d: 'W' });
    for (const bad of ['', '0', '0,0,', '0, 0', '+1,0', '0,0,E', '1.5,0', 'a,b', null, 3]) {
      expect(parseHex(bad)).toBeNull();
      expect(parseVertex(bad)).toBeNull();
      expect(parseEdge(bad)).toBeNull();
    }
    expect(parseVertex('0,0,NE')).toBeNull();
    expect(parseEdge('0,0,N')).toBeNull();
    // No -0 ever comes out of the formatters.
    expect(hexCorners(0, 0).concat(hexSides(0, 0)).every((id) => !id.includes('-0'))).toBe(true);
  });

  it('names the six corners of a hex clockwise from the top, each at the right point', () => {
    expect(hexCorners(0, 0)).toEqual(['0,0,N', '1,-1,S', '0,1,N', '0,0,S', '-1,1,N', '0,-1,S']);
    const c = { x: 0, y: 0 };
    const at = (deg: number) => ({ x: c.x + Math.sin((deg * Math.PI) / 180), y: c.y - Math.cos((deg * Math.PI) / 180) });
    hexCorners(0, 0).forEach((v, i) => expect(close(vertexPoint(v), at(i * 60))).toBe(true));
  });

  it('gives every side two ends that are corners of the hex it bounds', () => {
    for (const { q, r } of islandCells('large')) {
      const corners = new Set(hexCorners(q, r));
      const sides = hexSides(q, r);
      expect(new Set(sides).size).toBe(6);
      for (const e of sides) for (const v of edgeEnds(e)) expect(corners.has(v)).toBe(true);
      // Consecutive sides share a corner, so the six sides close the ring.
      sides.forEach((e, i) => {
        const next = sides[(i + 1) % 6];
        expect(edgeEnds(e).some((v) => edgeEnds(next).includes(v))).toBe(true);
      });
    }
  });

  it('keeps corner neighbours, corner sides and corner hexes consistent', () => {
    const g = geometry('large');
    for (const v of g.vertices) {
      const ns = vertexNeighbours(v);
      expect(new Set(ns).size).toBe(3);
      // Symmetric, one unit apart, and joined by exactly one of the corner's sides.
      for (const n of ns) {
        expect(vertexNeighbours(n)).toContain(v);
        const a = vertexPoint(v);
        const b = vertexPoint(n);
        expect(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 1)).toBeLessThan(1e-9);
        expect(vertexEdges(v).filter((e) => edgeEnds(e).includes(n))).toHaveLength(1);
      }
      for (const e of vertexEdges(v)) expect(edgeEnds(e)).toContain(v);
      for (const h of vertexHexes(v)) {
        const { q, r } = parseHex(h)!;
        expect(hexCorners(q, r)).toContain(v);
      }
    }
  });

  it('has the island sizes the spec counts', () => {
    const expected = { standard: [19, 54, 72, 30], large: [31, 84, 114, 42] };
    for (const size of SIZES) {
      const g = geometry(size);
      expect([g.hexes.length, g.vertices.length, g.edges.length, g.coast.length]).toEqual(expected[size]);
    }
    expect(harbourPositions('standard')).toEqual([0, 3, 6, 10, 13, 16, 20, 23, 26]);
    expect(harbourPositions('large')).toEqual([0, 3, 7, 11, 15, 19, 22, 26, 30, 34, 38]);
  });

  it('can name a coastal corner by a sea hex — membership is by the board set', () => {
    const g = geometry('standard');
    const sea = g.vertices.filter((v) => !g.hexSet.has(v.split(',').slice(0, 2).join(',')));
    expect(sea.length).toBeGreaterThan(0);
    expect(g.vertexSet.has('5,5,N')).toBe(false);
  });

  it('counts pips', () => {
    expect([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(pips)).toEqual([1, 2, 3, 4, 5, 0, 5, 4, 3, 2, 1]);
    expect(pips(null)).toBe(0);
  });
});

describe('generating an island', () => {
  it.each(SIZES)('%s: 500 seeded islands keep every balance rule, count and spacing', (size) => {
    const g = geometry(size);
    const spec = ISLAND[size];
    const index = new Map(g.hexes.map((h, i) => [h, i]));
    let fallbacks = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const board = generateIsland(size, seeded(seed));
      if (board.fallback) fallbacks++;
      expect(board.hexes.map((h) => h.id)).toEqual(g.hexes);
      // Tiles and tokens as the table says.
      const kinds: Record<string, number> = {};
      for (const h of board.hexes) kinds[h.kind] = (kinds[h.kind] ?? 0) + 1;
      expect(kinds).toEqual(spec.tiles);
      const tokens = board.hexes.filter((h) => h.token !== null).map((h) => h.token!).sort((a, b) => a - b);
      expect(tokens).toEqual([...spec.tokens].sort((a, b) => a - b));
      expect(board.hexes.filter((h) => h.kind === 'dunes').every((h) => h.token === null && h.resource === null)).toBe(true);
      // The three rules, checked here independently of the generator's own check.
      for (const h of board.hexes) {
        for (const [nq, nr] of hexNeighbours(h.q, h.r)) {
          const j = index.get(`${nq},${nr}`);
          if (j === undefined) continue;
          const o = board.hexes[j];
          if (h.token === null || o.token === null) continue;
          expect([6, 8].includes(h.token) && [6, 8].includes(o.token)).toBe(false);
          expect(h.token).not.toBe(o.token);
        }
      }
      for (const v of g.vertices) {
        const land = g.vertexLand.get(v)!.map((id) => board.hexes[index.get(id)!].kind);
        if (land.length === 3 && land[0] !== 'dunes') expect(land[0] === land[1] && land[1] === land[2]).toBe(false);
      }
      // Harbours: the right kinds, on coastal edges, never two on one corner.
      expect(board.harbours.map((h) => h.kind).sort()).toEqual([...spec.harbours].sort());
      expect(board.harbours.every((h) => g.coast.includes(h.edge) && h.rate === (h.kind === 'any' ? 3 : 2))).toBe(true);
      const corners = board.harbours.flatMap((h) => edgeEnds(h.edge));
      expect(new Set(corners).size).toBe(corners.length);
    }
    // The fallback is a safety net, not the normal path.
    expect(fallbacks).toBe(0);
  });

  it('uses a balanced fixed layout when the shuffles never balance', () => {
    for (const size of SIZES) {
      expect(balanced(size, FALLBACK[size].kinds, FALLBACK[size].tokens)).toBe(true);
      expect(FALLBACK[size].kinds.length).toBe(geometry(size).hexes.length);
      // Out of tries (none allowed here): the fixed layout, with harbours still dealt.
      const board = generateIsland(size, seeded(3), 0);
      expect(board.fallback).toBe(true);
      expect(board.hexes.map((h) => h.kind)).toEqual(FALLBACK[size].kinds);
      expect(board.hexes.map((h) => h.token)).toEqual(FALLBACK[size].tokens);
    }
  });

  it('is reproducible from a seed', () => {
    expect(generateIsland('large', seeded(7))).toEqual(generateIsland('large', seeded(7)));
    expect(generateIsland('large', seeded(7))).not.toEqual(generateIsland('large', seeded(8)));
  });

  it('lists resources in their fixed order', () => {
    expect(RESOURCES).toEqual(['timber', 'clay', 'wool', 'grain', 'stone']);
  });
});
