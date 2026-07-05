import { describe, it, expect } from 'vitest';
import { retrieve, buildContextBlock, normalize, dot } from '$lib/rag/retrieve';
import type { RagChunk } from '$lib/rag/types';

function chunk(id: string, vector: number[], text = id, source = 'doc.txt', ord = 0): RagChunk {
  return { id, text, vector: normalize(vector), source, ord, charStart: 0, charEnd: text.length };
}

describe('normalize / dot', () => {
  it('normalizes to unit length', () => {
    const v = normalize([3, 4]);
    expect(Math.hypot(...v)).toBeCloseTo(1, 6);
  });
  it('dot of identical unit vectors is 1', () => {
    const a = normalize([1, 2, 3]);
    expect(dot(a, a)).toBeCloseTo(1, 6);
  });
  it('dot of orthogonal vectors is 0', () => {
    expect(dot(normalize([1, 0]), normalize([0, 1]))).toBeCloseTo(0, 6);
  });
  it('handles a zero vector without NaN', () => {
    const v = normalize([0, 0, 0]);
    expect(v.every((x) => Number.isFinite(x))).toBe(true);
  });
});

describe('retrieve', () => {
  const index: RagChunk[] = [
    chunk('a', [1, 0, 0], 'apples and oranges'),
    chunk('b', [0.9, 0.1, 0], 'apple pie recipe'),
    chunk('c', [0, 1, 0], 'quantum mechanics'),
    chunk('d', [0, 0, 1], 'gardening tips'),
  ];

  it('ranks by similarity to the query', () => {
    const q = normalize([1, 0, 0]);
    const hits = retrieve(index, q, { topK: 4, minSim: -1 });
    expect(hits[0].id).toBe('a');
    expect(hits[1].id).toBe('b');
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
  });

  it('respects topK', () => {
    const q = normalize([1, 0, 0]);
    expect(retrieve(index, q, { topK: 2, minSim: -1 })).toHaveLength(2);
  });

  it('drops hits below the similarity threshold', () => {
    const q = normalize([1, 0, 0]);
    const hits = retrieve(index, q, { topK: 10, minSim: 0.5 });
    // Only a (1.0) and b (~0.994) clear 0.5; c and d are orthogonal (0).
    expect(hits.map((h) => h.id).sort()).toEqual(['a', 'b']);
  });

  it('returns empty for an empty index', () => {
    expect(retrieve([], normalize([1, 0, 0]), {})).toHaveLength(0);
  });
});

describe('buildContextBlock', () => {
  it('returns empty string when there are no hits', () => {
    expect(buildContextBlock([]).block).toBe('');
    expect(buildContextBlock([]).citations).toHaveLength(0);
  });

  it('emits numbered passages and matching citations', () => {
    const hits = [
      { ...chunk('a', [1, 0, 0], 'apples are red', 'fruit.txt', 3), score: 0.99 },
      { ...chunk('c', [0, 1, 0], 'physics is hard', 'sci.txt', 7), score: 0.6 },
    ];
    const { block, citations } = buildContextBlock(hits);
    expect(block).toContain('[1]');
    expect(block).toContain('[2]');
    expect(block).toContain('apples are red');
    expect(block).toContain('fruit.txt');
    expect(citations).toEqual([
      { n: 1, source: 'fruit.txt', ord: 3 },
      { n: 2, source: 'sci.txt', ord: 7 },
    ]);
  });

  it('caps very long passages', () => {
    const long = 'x'.repeat(5000);
    const hits = [{ ...chunk('a', [1, 0, 0], long, 'big.txt', 0), score: 0.9 }];
    const { block } = buildContextBlock(hits);
    expect(block.length).toBeLessThan(long.length);
  });
});
