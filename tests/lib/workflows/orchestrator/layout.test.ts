import { describe, it, expect } from 'vitest';
import { autoLayout } from '$lib/workflows/orchestrator/layout';

describe('autoLayout', () => {
  it('positions a single node at origin', () => {
    const nodes = [{ id: 'a', type: 'manual-trigger' }];
    const edges: Array<{ source: string; target: string }> = [];
    const result = autoLayout(nodes, edges);
    expect(result.get('a')).toEqual({ x: 50, y: 200 });
  });

  it('lays out a linear chain left to right', () => {
    const nodes = [
      { id: 'a', type: 'manual-trigger' },
      { id: 'b', type: 'transform' },
      { id: 'c', type: 'http-request' },
    ];
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ];
    const result = autoLayout(nodes, edges);
    const a = result.get('a')!;
    const b = result.get('b')!;
    const c = result.get('c')!;
    expect(b.x).toBe(a.x + 300);
    expect(c.x).toBe(b.x + 300);
    expect(a.y).toBe(b.y);
    expect(b.y).toBe(c.y);
  });

  it('fans out branches vertically', () => {
    const nodes = [
      { id: 'a', type: 'conditional' },
      { id: 'b', type: 'transform' },
      { id: 'c', type: 'email' },
    ];
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
    ];
    const result = autoLayout(nodes, edges);
    const b = result.get('b')!;
    const c = result.get('c')!;
    expect(b.y).not.toBe(c.y);
    expect(Math.abs(b.y - c.y)).toBeGreaterThanOrEqual(180);
  });

  it('returns positions for all nodes', () => {
    const nodes = [{ id: 'a', type: 'x' }, { id: 'b', type: 'y' }];
    const edges = [{ source: 'a', target: 'b' }];
    const result = autoLayout(nodes, edges);
    expect(result.size).toBe(2);
  });
});
