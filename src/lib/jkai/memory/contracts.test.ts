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
