import { describe, it, expect } from 'vitest';
import { hashId } from './layout';

describe('hashId', () => {
  it('is deterministic for the same input', () => {
    expect(hashId('abc')).toBe(hashId('abc'));
    expect(hashId('source-42')).toBe(hashId('source-42'));
  });

  it('returns a non-negative 32-bit integer', () => {
    for (const id of ['', 'a', 'fact-1', 'a-very-long-uuid-0123456789abcdef']) {
      const h = hashId(id);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('differs for single-character changes (no trivial collisions)', () => {
    expect(hashId('abc')).not.toBe(hashId('abd'));
    expect(hashId('abc')).not.toBe(hashId('cba'));
    expect(hashId('fact-1')).not.toBe(hashId('fact-2'));
  });

  it('is well distributed across a large id set (low collision rate)', () => {
    const seen = new Set<number>();
    const N = 2000;
    for (let i = 0; i < N; i++) seen.add(hashId(`artefact-${i}`));
    // Allow a tiny number of collisions but demand near-injectivity.
    expect(seen.size).toBeGreaterThan(N * 0.999);
  });
});
