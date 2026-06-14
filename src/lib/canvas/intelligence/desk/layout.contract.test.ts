import { describe, it, expect } from 'vitest';
import { hashId, scatterPosition, organisedLayout } from './layout';

describe('layout.ts public contract surface', () => {
  it('hashId(id: string): number', () => {
    const r = hashId('x');
    expect(typeof r).toBe('number');
  });

  it('scatterPosition(id: string, phase: number): {x,y}', () => {
    const r = scatterPosition('x', 1);
    expect(Object.keys(r).sort()).toEqual(['x', 'y']);
    expect(typeof r.x).toBe('number');
    expect(typeof r.y).toBe('number');
  });

  it('organisedLayout(artefacts, categories): Map<string,{x,y}>', () => {
    const r = organisedLayout(
      [{ id: 'a', kind: 'fact', categoryId: 'c1' }],
      [{ id: 'c1', title: 'C1' }],
    );
    expect(r).toBeInstanceOf(Map);
    const p = r.get('a')!;
    expect(typeof p.x).toBe('number');
    expect(typeof p.y).toBe('number');
  });
});
