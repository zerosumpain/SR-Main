import { describe, it, expect } from 'vitest';
import { reconcileClusters, type LlmCluster } from './synthesis-reconcile';

// idByIndex: 1-based index → real fact UUID (the map synthesis.ts builds when it
// presents facts to the LLM as `[1] <content>`, `[2] <content>`, …).
function idMap(ids: string[]): Map<number, string> {
  const m = new Map<number, string>();
  ids.forEach((id, i) => m.set(i + 1, id));
  return m;
}

const IDS = ['uuid-a', 'uuid-b', 'uuid-c', 'uuid-d'];

describe('reconcileClusters', () => {
  it('maps valid 1-based indices back to real fact UUIDs', () => {
    const llm: LlmCluster[] = [
      { title: 'Econ', summary: 's1', facts: [1, 3] },
      { title: 'Social', summary: 's2', facts: [2, 4] },
    ];
    const out = reconcileClusters(llm, idMap(IDS), IDS, 'run1');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'run1-c0', title: 'Econ', summary: 's1', fact_ids: ['uuid-a', 'uuid-c'] });
    expect(out[1]).toMatchObject({ id: 'run1-c1', title: 'Social', summary: 's2', fact_ids: ['uuid-b', 'uuid-d'] });
  });

  it('drops out-of-range and garbage indices, keeping the cluster if any survive', () => {
    const llm: LlmCluster[] = [
      // 0 (1-based has no 0), 99 out of range, 2.5 non-integer, NaN, negative -> only 1 & 4 survive
      { title: 'Mixed', summary: 's', facts: [0, 99, 2.5 as number, NaN, -1, 1, 4] },
    ];
    const out = reconcileClusters(llm, idMap(IDS), IDS, 'run2');
    expect(out).toHaveLength(1);
    expect(out[0].fact_ids).toEqual(['uuid-a', 'uuid-d']);
  });

  it('de-duplicates repeated indices within a cluster', () => {
    const llm: LlmCluster[] = [{ title: 'Dup', summary: 's', facts: [2, 2, 3, 3, 3] }];
    const out = reconcileClusters(llm, idMap(IDS), IDS, 'run3');
    expect(out[0].fact_ids).toEqual(['uuid-b', 'uuid-c']);
  });

  it('drops clusters that end up empty but keeps non-empty ones', () => {
    const llm: LlmCluster[] = [
      { title: 'Empty', summary: 'e', facts: [99, 0] },
      { title: 'Good', summary: 'g', facts: [1] },
    ];
    const out = reconcileClusters(llm, idMap(IDS), IDS, 'run4');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'run4-c0', title: 'Good', fact_ids: ['uuid-a'] });
  });

  it('all-empty fallback: every cluster invalid → single "All Findings" cluster with ALL ids', () => {
    const llm: LlmCluster[] = [
      { title: 'Bad1', summary: 'x', facts: [99] },
      { title: 'Bad2', summary: 'y', facts: [] },
    ];
    const out = reconcileClusters(llm, idMap(IDS), IDS, 'run5', 'Exec summary here');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'run5-c0',
      title: 'All Findings',
      summary: 'Exec summary here',
      fact_ids: IDS,
    });
  });

  it('all-empty fallback uses a sensible default summary when none provided', () => {
    const out = reconcileClusters([], idMap(IDS), IDS, 'run6');
    expect(out).toHaveLength(1);
    expect(out[0].fact_ids).toEqual(IDS);
    expect(out[0].title).toBe('All Findings');
    expect(out[0].summary.length).toBeGreaterThan(0);
  });

  it('preserves cluster ordering (ids assigned by surviving position)', () => {
    const llm: LlmCluster[] = [
      { title: 'First', summary: 'a', facts: [1] },
      { title: 'DropMe', summary: 'b', facts: [99] },
      { title: 'Second', summary: 'c', facts: [2] },
    ];
    const out = reconcileClusters(llm, idMap(IDS), IDS, 'run7');
    expect(out.map((c) => c.title)).toEqual(['First', 'Second']);
    expect(out.map((c) => c.id)).toEqual(['run7-c0', 'run7-c1']);
  });

  it('tolerates a missing/non-array facts field (treats as empty → fallback if all empty)', () => {
    const llm = [{ title: 'NoFacts', summary: 's' }] as unknown as LlmCluster[];
    const out = reconcileClusters(llm, idMap(IDS), IDS, 'run8');
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('All Findings');
    expect(out[0].fact_ids).toEqual(IDS);
  });

  it('coerces numeric-string indices ("1") to numbers', () => {
    const llm = [{ title: 'StrIdx', summary: 's', facts: ['1', '3'] }] as unknown as LlmCluster[];
    const out = reconcileClusters(llm, idMap(IDS), IDS, 'run9');
    expect(out[0].fact_ids).toEqual(['uuid-a', 'uuid-c']);
  });
});
