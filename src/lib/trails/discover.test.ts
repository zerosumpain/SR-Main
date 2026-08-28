import { describe, expect, it } from 'vitest';
import {
  bboxAround,
  lineDistanceM,
  networkLabel,
  parseRelations,
  stitchRelation,
  type OverpassResponse,
} from './discover';

describe('bboxAround', () => {
  it('spans roughly 2× the radius in each axis', () => {
    const [south, west, north, east] = bboxAround(54.5, -1.5, 15);
    expect(north - south).toBeCloseTo(30 / 111.32, 3);
    // Longitude degrees are shorter at 54.5°N, so the span is wider.
    expect(east - west).toBeGreaterThan(north - south);
    expect((south + north) / 2).toBeCloseTo(54.5, 6);
  });
});

describe('parseRelations', () => {
  const rel = (id: number, tags: Record<string, string>) => ({
    type: 'relation' as const,
    id,
    tags,
  });

  it('keeps named routes, drops unnamed ones without a ref', () => {
    const out = parseRelations([
      rel(1, { name: 'Teesdale Way', network: 'rwn' }),
      rel(2, {}),
      rel(3, { ref: 'E2' }),
    ]);
    expect(out.map((r) => r.osmId)).toEqual([1, 3]);
  });

  it('orders national trails above local ones', () => {
    const out = parseRelations([
      rel(1, { name: 'Local loop', network: 'lwn' }),
      rel(2, { name: 'Pennine Way', network: 'nwn' }),
      rel(3, { name: 'Unranked path' }),
    ]);
    expect(out.map((r) => r.name)).toEqual(['Pennine Way', 'Local loop', 'Unranked path']);
  });

  it('reads a distance tag, tolerating units', () => {
    const out = parseRelations([rel(1, { name: 'A', distance: '146 km' })]);
    expect(out[0].distanceKm).toBe(146);
  });
});

describe('stitchRelation', () => {
  // Two ways sharing node 3; the second is stored reversed and must be flipped.
  const data: OverpassResponse = {
    elements: [
      { type: 'node', id: 1, lon: -1.5, lat: 54.5 },
      { type: 'node', id: 2, lon: -1.49, lat: 54.5 },
      { type: 'node', id: 3, lon: -1.48, lat: 54.51 },
      { type: 'node', id: 4, lon: -1.47, lat: 54.52 },
      { type: 'way', id: 10, nodes: [1, 2, 3] },
      { type: 'way', id: 11, nodes: [4, 3] },
      {
        type: 'relation',
        id: 100,
        tags: { name: 'Test Way' },
        members: [
          { type: 'way', ref: 10 },
          { type: 'way', ref: 11 },
        ],
      },
    ],
  };

  it('stitches ways into one line, reversing and deduplicating at joins', () => {
    const { name, coordinates } = stitchRelation(data);
    expect(name).toBe('Test Way');
    expect(coordinates).toEqual([
      [-1.5, 54.5],
      [-1.49, 54.5],
      [-1.48, 54.51],
      [-1.47, 54.52],
    ]);
  });

  it('throws when the relation has no usable geometry', () => {
    expect(() =>
      stitchRelation({
        elements: [{ type: 'relation', id: 5, members: [], tags: {} }],
      }),
    ).toThrow(/no usable way geometry/);
  });
});

describe('lineDistanceM', () => {
  it('measures a known line', () => {
    // ~1.11 km per 0.01° of latitude.
    const d = lineDistanceM([
      [-1.5, 54.5],
      [-1.5, 54.51],
    ]);
    expect(d).toBeGreaterThan(1050);
    expect(d).toBeLessThan(1180);
  });
});

describe('networkLabel', () => {
  it('labels known networks and falls back honestly', () => {
    expect(networkLabel('nwn')).toBe('National trail');
    expect(networkLabel('ncn')).toBe('National cycle route');
    expect(networkLabel('')).toBe('Mapped route');
  });
});
