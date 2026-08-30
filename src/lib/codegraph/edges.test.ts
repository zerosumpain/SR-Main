import { describe, it, expect } from 'vitest';
import {
  SYMMETRIC_EDGE_KINDS,
  canonicalEdge,
  carriesBehaviouralEdges,
  shapeEdges,
} from './edges';

describe('canonical direction for symmetric edges', () => {
  it('swaps a co_change pair into sorted order', () => {
    expect(canonicalEdge({ source: 'b.ts', target: 'a.ts', kind: 'co_change' })).toEqual({
      source: 'a.ts',
      target: 'b.ts',
      kind: 'co_change',
    });
  });

  it('leaves an already-sorted pair alone', () => {
    const e = { source: 'a.ts', target: 'b.ts', kind: 'co_change' };
    expect(canonicalEdge(e)).toEqual(e);
  });

  it('gives both orderings of one relationship the same identity', () => {
    // This is the whole point: production held 408 co_change pairs stored twice,
    // each with half the weight, so a habit ranked below a coincidence.
    const ab = canonicalEdge({ source: 'a.ts', target: 'b.ts', kind: 'co_change' });
    const ba = canonicalEdge({ source: 'b.ts', target: 'a.ts', kind: 'co_change' });
    expect(ab).toEqual(ba);
  });

  it('NEVER reorders imports — a mutual pair is a circular dependency, not a duplicate', () => {
    const e = { source: 'b.ts', target: 'a.ts', kind: 'imports' };
    expect(canonicalEdge(e)).toEqual(e);
    expect(SYMMETRIC_EDGE_KINDS.has('imports')).toBe(false);
    expect(SYMMETRIC_EDGE_KINDS.has('tests')).toBe(false);
  });
});

describe('which paths may carry behavioural edges', () => {
  it('excludes plan documents — they enumerate the files they describe', () => {
    // Every duplicated co_change pair sampled from production was a
    // docs/superpowers/plans/*.md paired with a file its own plan listed.
    expect(carriesBehaviouralEdges('docs/superpowers/plans/2026-08-08-x.md')).toBe(false);
    expect(carriesBehaviouralEdges('README.md')).toBe(false);
    expect(carriesBehaviouralEdges('static/foo.svg')).toBe(false);
    expect(carriesBehaviouralEdges('package-lock.json')).toBe(false);
  });

  it('keeps real source', () => {
    expect(carriesBehaviouralEdges('src/lib/jkai/orchestrator.ts')).toBe(true);
    expect(carriesBehaviouralEdges('src/routes/api/x/+server.ts')).toBe(true);
    expect(carriesBehaviouralEdges('scripts/codegraph-backfill.mjs')).toBe(true);
  });

  it('is false for empty input rather than throwing', () => {
    expect(carriesBehaviouralEdges(null)).toBe(false);
    expect(carriesBehaviouralEdges('')).toBe(false);
  });
});

describe('shaping a batch', () => {
  it('drops a behavioural edge that touches a doc, at either end', () => {
    const out = shapeEdges([
      { source: 'docs/plan.md', target: 'src/a.ts', kind: 'co_change' },
      { source: 'src/a.ts', target: 'docs/plan.md', kind: 'needs_context' },
      { source: 'src/a.ts', target: 'src/b.ts', kind: 'co_change' },
    ]);
    expect(out).toEqual([{ source: 'src/a.ts', target: 'src/b.ts', kind: 'co_change' }]);
  });

  it('keeps a STATIC edge to a doc — only behavioural kinds are filtered', () => {
    const out = shapeEdges([{ source: 'src/a.ts', target: 'docs/plan.md', kind: 'imports' }]);
    expect(out).toHaveLength(1);
  });

  /*
   * The failure the merge exists to prevent. Canonicalising is what CREATES the
   * collision: both halves become the same (source,target,kind), and Postgres
   * rejects a batch containing two such rows outright —
   * "ON CONFLICT DO UPDATE command cannot affect row a second time" — which
   * fails the entire insert, not the duplicate.
   */
  it('merges mirrored halves into one row and SUMS their weight', () => {
    const out = shapeEdges([
      { source: 'a.ts', target: 'b.ts', kind: 'co_change', weight: 3 },
      { source: 'b.ts', target: 'a.ts', kind: 'co_change', weight: 2 },
    ]);
    expect(out).toEqual([{ source: 'a.ts', target: 'b.ts', kind: 'co_change', weight: 5 }]);
  });

  it('emits no duplicate conflict key for any input ordering', () => {
    const out = shapeEdges([
      { source: 'b.ts', target: 'a.ts', kind: 'co_change' },
      { source: 'a.ts', target: 'b.ts', kind: 'co_change' },
      { source: 'a.ts', target: 'b.ts', kind: 'needs_context' },
      { source: 'b.ts', target: 'a.ts', kind: 'needs_context' },
    ]);
    const keys = out.map((e) => `${e.source}|${e.target}|${e.kind}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(out).toHaveLength(2);
  });

  it('does not merge across kinds', () => {
    const out = shapeEdges([
      { source: 'a.ts', target: 'b.ts', kind: 'co_change', weight: 1 },
      { source: 'a.ts', target: 'b.ts', kind: 'imports', weight: 1 },
    ]);
    expect(out).toHaveLength(2);
  });

  it('drops self-pairs', () => {
    expect(shapeEdges([{ source: 'a.ts', target: 'a.ts', kind: 'co_change' }])).toEqual([]);
  });
});
