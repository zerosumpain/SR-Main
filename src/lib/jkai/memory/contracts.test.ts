import { expect, it } from 'vitest';
import { renderMemories, memoryScore, type RankedMemory } from './contracts';
const row = (id: string, content: string): RankedMemory => ({ id, content, category: 'people', confidence: 'high', updatedAt: new Date('2026-09-01') });
it('skips oversized entries while retaining relevant provenance and pinned facts', () => {
  const result = renderMemories([row('large', 'x'.repeat(6000)), row('useful', 'John cycles in London')], 'cycles', 500);
  expect(result).toContain('memory:useful');
  expect(result).toContain('confidence=high');
  expect(result).not.toContain('memory:large');
});
it('excludes expired memories and does not equate Daydream rulings with user facts', () => {
  const r = row('expired', 'old address'); r.provenance = { origin: 'user', validUntil: '2020-01-01' };
  expect(memoryScore(r, 'address')).toBe(-Infinity);
  expect(renderMemories([{ ...row('finding', 'may enjoy cycling'), daydreamOrigin: 'ruling' }], '')).toContain('daydream-ruling');
});

// ── Additions for the thread inspector's Memory mode ──────────────────────
import { describe } from 'vitest';
import { isStaleMemoryState, memoryIdsInStep, memoryState, memoryToolVerb, selectMemoryLines } from './contracts';

describe('selectMemoryLines', () => {
  it('reports which ids reached the model and which were dropped', () => {
    const sel = selectMemoryLines([row('large', 'x'.repeat(6000)), row('useful', 'John cycles in London')], 'cycles', 500);
    expect(sel.served).toEqual(['useful']);
    expect(sel.omitted).toEqual(['large']);
    expect(sel.retrieved).toBe(2);
    expect(sel.chars).toBeGreaterThan(0);
    expect(sel.text).toBe(renderMemories([row('large', 'x'.repeat(6000)), row('useful', 'John cycles in London')], 'cycles', 500));
  });
  it('is empty, not undefined, when nothing was retrieved', () => {
    expect(selectMemoryLines([], 'anything')).toEqual({ text: '', served: [], omitted: [], retrieved: 0, chars: 0 });
  });
});

describe('memoryState', () => {
  const now = Date.parse('2026-09-06T12:00:00Z');
  it('derives the vocabulary from the row alone', () => {
    expect(memoryState({ supersededBy: 'forgotten' }, now)).toBe('forgotten');
    expect(memoryState({ supersededBy: 'other-id' }, now)).toBe('replaced');
    expect(memoryState({ supersededBy: null, provenance: { origin: 'user', validUntil: '2026-09-01' } }, now)).toBe('expired');
    expect(memoryState({ supersededBy: null, provenance: { origin: 'user', validUntil: '2026-09-15' } }, now)).toBe('expiring');
    expect(memoryState({ supersededBy: null, provenance: { origin: 'user', pinned: true } }, now)).toBe('pinned');
    expect(memoryState({ supersededBy: null, provenance: null }, now)).toBe('current');
  });
  it('a forgotten row is forgotten even when pinned', () => {
    expect(memoryState({ supersededBy: 'forgotten', provenance: { origin: 'user', pinned: true } }, now)).toBe('forgotten');
  });
  it('names the stale states', () => {
    expect(isStaleMemoryState('replaced')).toBe(true);
    expect(isStaleMemoryState('expiring')).toBe(false);
    expect(isStaleMemoryState('pinned')).toBe(false);
  });
});

describe('memory tool steps', () => {
  it('maps the five tools to three verbs and nothing else', () => {
    expect(memoryToolVerb('save_memory')).toBe('written');
    expect(memoryToolVerb('memory_remember')).toBe('written');
    expect(memoryToolVerb('recall_memories')).toBe('recalled');
    expect(memoryToolVerb('memory_search')).toBe('recalled');
    expect(memoryToolVerb('forget_memory')).toBe('forgotten');
    expect(memoryToolVerb('web_search')).toBeNull();
  });
  it('reads ids from args for forget, result for write, and the list for recall', () => {
    expect(memoryIdsInStep({ tool: 'forget_memory', args: { id: 'a' } })).toEqual(['a']);
    expect(memoryIdsInStep({ tool: 'save_memory', args: {}, result: { data: { id: 'b' } } })).toEqual(['b']);
    expect(memoryIdsInStep({ tool: 'recall_memories', result: { data: { memories: [{ id: 'c' }, { id: 'c' }, { nope: 1 }] } } })).toEqual(['c']);
    expect(memoryIdsInStep({ tool: 'web_search', result: { data: { id: 'x' } } })).toEqual([]);
  });
});
