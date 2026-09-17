/**
 * An older writer must not be able to clear a column it has never heard of.
 *
 * On 2026-09-17 the changelog ingest cron was running a stale checkout whose
 * parser predated `pull_requests`. It sent no such field; the upsert wrote its
 * `[]` fallback; and every fifteen minutes it destroyed all 585 release links
 * across 296 sessions — silently, returning `ok: true`, on a loop. The data was
 * gone within an hour of shipping the feature that created it.
 *
 * The operational cause was fixed separately (the cron now runs a checkout
 * pinned to master). This is the belt: even if a stale writer reappears, an
 * absent key can no longer mean "erase".
 */
import { describe, it, expect } from 'vitest';
import { PRESERVED, updateSet } from '$lib/changelog/ingest-guard';

describe('updateSet', () => {
  it('drops a preserved key the payload omitted, so the stored value survives', () => {
    const set = updateSet({ title: 'x', pullRequests: undefined });
    expect('pullRequests' in set).toBe(false);
    expect(set.title).toBe('x');
  });

  it('keeps a preserved key the payload actually sent, including an empty one', () => {
    // Empty is a real instruction. A session that opened no pull request should
    // be able to say so and have that written.
    expect(updateSet({ pullRequests: [] }).pullRequests).toEqual([]);
    expect(updateSet({ pullRequests: [896, 897] }).pullRequests).toEqual([896, 897]);
  });

  it('does not protect ordinary columns — only the listed ones', () => {
    // The guard is deliberately narrow. Making every undefined field sticky
    // would mean a genuinely cleared value could never be cleared.
    const set = updateSet({ summary: undefined, pullRequests: [1] });
    expect('summary' in set).toBe(true);
    expect(set.summary).toBeUndefined();
  });

  it('always pins id to the existing row', () => {
    expect(updateSet({}).id).toBeDefined();
  });

  it('names the columns it protects', () => {
    expect([...PRESERVED]).toContain('pullRequests');
  });
});
