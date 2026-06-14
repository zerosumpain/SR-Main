// src/lib/canvas/intelligence/desk/store.test.ts
import { describe, it, expect } from 'vitest';
import { mergeArtefact, dedupHydrate, type DeskCard } from './store.svelte';

function card(id: string, extra: Partial<DeskCard> = {}): DeskCard {
  return { id, kind: 'fact', seq: 0, phase: 1, fields: {}, ...extra };
}

describe('dedupHydrate', () => {
  it('keeps one card per id, last write wins', () => {
    const map = dedupHydrate([
      card('a', { fields: { content: 'old' } }),
      card('b'),
      card('a', { fields: { content: 'new' } }),
    ]);
    expect(map.size).toBe(2);
    expect((map.get('a')!.fields as any).content).toBe('new');
  });
});

describe('mergeArtefact', () => {
  it('inserts a new card by id', () => {
    const base = new Map<string, DeskCard>();
    const next = mergeArtefact(base, card('x', { seq: 5 }));
    expect(next.get('x')!.seq).toBe(5);
    expect(next).not.toBe(base); // new container (raw replacement)
  });

  it('dedups: a repeated id does not create a second card', () => {
    let m = new Map<string, DeskCard>();
    m = mergeArtefact(m, card('dup', { seq: 1 }));
    m = mergeArtefact(m, card('dup', { seq: 2 }));
    expect(m.size).toBe(1);
  });

  it('ignores an out-of-order (lower-seq) delta for an existing id', () => {
    let m = new Map<string, DeskCard>();
    m = mergeArtefact(m, card('s', { seq: 10, fields: { content: 'fresh' } }));
    m = mergeArtefact(m, card('s', { seq: 4, fields: { content: 'stale' } }));
    expect((m.get('s')!.fields as any).content).toBe('fresh');
    expect(m.get('s')!.seq).toBe(10);
  });

  it('applies a newer (higher-seq) delta to an existing id', () => {
    let m = new Map<string, DeskCard>();
    m = mergeArtefact(m, card('s', { seq: 1, fields: { content: 'a' } }));
    m = mergeArtefact(m, card('s', { seq: 7, fields: { content: 'b' } }));
    expect((m.get('s')!.fields as any).content).toBe('b');
  });

  it('never mutates the input map', () => {
    const base = new Map<string, DeskCard>([['k', card('k')]]);
    const snapshot = base.get('k');
    mergeArtefact(base, card('k', { seq: 9 }));
    expect(base.get('k')).toBe(snapshot); // original untouched
  });
});
