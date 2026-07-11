import { describe, expect, it } from 'vitest';
import { donutSegments, sankeyDepths, sankeyLayout } from './chartkit';

describe('sankeyDepths', () => {
  it('layers an acyclic flow left to right, sinks pushed last', () => {
    const d = sankeyDepths([
      { from: 'a', to: 'b', value: 1 },
      { from: 'a', to: 'c', value: 1 },
      { from: 'b', to: 'd', value: 1 },
      { from: 'c', to: 'd', value: 1 },
    ]);
    expect(d).not.toBeNull();
    expect(d!.get('a')).toBe(0);
    expect(d!.get('b')).toBe(1);
    expect(d!.get('d')).toBe(2);
  });

  it('short chains end in the sink column', () => {
    const d = sankeyDepths([
      { from: 'a', to: 'b', value: 1 },
      { from: 'b', to: 'c', value: 1 },
      { from: 'a', to: 'c', value: 1 },
    ]);
    expect(d!.get('c')).toBe(2);
  });

  it('returns null on a cycle', () => {
    expect(
      sankeyDepths([
        { from: 'a', to: 'b', value: 1 },
        { from: 'b', to: 'a', value: 1 },
      ]),
    ).toBeNull();
  });
});

describe('sankeyLayout', () => {
  it('produces one node per id and one ribbon per flow inside the frame', () => {
    const g = sankeyLayout(
      [
        { from: 'raw', to: 'director', value: 6 },
        { from: 'media', to: 'director', value: 4 },
        { from: 'director', to: 'pages', value: 10 },
      ],
      760,
      430,
    );
    expect(g).not.toBeNull();
    expect(g!.nodes).toHaveLength(4);
    expect(g!.links).toHaveLength(3);
    for (const n of g!.nodes) {
      expect(n.y0).toBeGreaterThanOrEqual(0);
      expect(n.y1).toBeLessThanOrEqual(430);
      expect(n.x1).toBeLessThanOrEqual(760);
    }
    for (const l of g!.links) expect(l.path).toMatch(/^M[\d.]+,[\d.]+ C/);
  });

  it('returns null on a cycle', () => {
    expect(sankeyLayout([{ from: 'a', to: 'a', value: 1 }], 760, 430)).toBeNull();
  });
});

describe('donutSegments', () => {
  it('fractions sum to 1 and paths are annulus slices', () => {
    const segs = donutSegments([45, 30, 25], 380, 215, 150, 92);
    expect(segs).toHaveLength(3);
    expect(segs.reduce((a, s) => a + s.frac, 0)).toBeCloseTo(1, 6);
    for (const s of segs) expect(s.path).toContain('A150,150');
  });
});
