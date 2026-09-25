import { describe, it, expect } from 'vitest';
import { withNow } from '$lib/workflows/orchestrator/prompts';

describe('withNow', () => {
  it('gives the model today in Europe/London so "till 6pm today" can become a schedule', () => {
    // 10:16 UTC on 25 Sep 2026 is 11:16 BST.
    const out = withNow('send me a joke every hour till 6pm today', new Date('2026-09-25T10:16:00Z'));
    expect(out).toContain('send me a joke every hour till 6pm today');
    expect(out).toMatch(/Friday,? 25 September 2026/);
    expect(out).toContain('11:16');
    expect(out).toContain('Europe/London');
  });

  it('keeps the original message first so nothing is lost', () => {
    expect(withNow('x', new Date('2026-01-01T00:00:00Z')).startsWith('x\n\n(Now:')).toBe(true);
  });
});
