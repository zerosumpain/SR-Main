/**
 * The pending queue must be able to SEE a stuck release.
 *
 * `summariseRelease` returns early on `summary_status = 'ok'`, and both
 * `countPending` and `summarisePending` selected purely on that status. So a row
 * that reached `ok` while writing no items was stranded permanently: never
 * counted, never retried, and reported as "0 remaining" — a queue that cannot
 * represent a stuck item is indistinguishable from an empty one.
 *
 * The distinction that matters is evidence. A re-deploy of the same tree is
 * legitimately item-less and `summariseRelease` writes exactly that for an empty
 * commit range. Only a release WITH commits and WITHOUT items is wrong.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db } from '$lib/db';
import { releases } from '$lib/db/schema';
import { countPending } from '$lib/releases/summarise';
import { eq, like } from 'drizzle-orm';

const SHA_PREFIX = 'testpendingqueue';

const commit = {
  sha: `${SHA_PREFIX}00000000000000000000000000`,
  short: 'testpend',
  author: 'Test',
  date: '2026-09-17T00:00:00Z',
  subject: 'feat: something worth describing',
  body: '',
  pr: null,
};

async function clear() {
  await db.delete(releases).where(like(releases.sha, `${SHA_PREFIX}%`));
}

async function insert(n: number, commits: unknown[]) {
  const [row] = await db
    .insert(releases)
    .values({
      sha: `${SHA_PREFIX}${String(n).padStart(26, '0')}`,
      shortSha: `tp${n}`,
      version: `2026.09.17.${n}`,
      deployedAt: new Date('2026-09-17T00:00:00Z'),
      commits,
      summaryStatus: 'ok',
    })
    .returning({ id: releases.id });
  return row.id;
}

beforeEach(clear);
afterAll(clear);

describe('countPending', () => {
  it('counts an ok release that has commits but wrote no items', async () => {
    const before = await countPending();
    await insert(1, [commit]);
    expect(await countPending()).toBe(before + 1);
  });

  it('does not count an ok release with an empty commit range', async () => {
    // The re-deploy case: no commits means there was genuinely nothing to say,
    // and summariseRelease writes that deliberately. Counting it would make the
    // queue permanently non-empty on a healthy site.
    const before = await countPending();
    await insert(2, []);
    expect(await countPending()).toBe(before);
  });

  it('stops counting a stranded release once it has items', async () => {
    const before = await countPending();
    const id = await insert(3, [commit]);
    expect(await countPending()).toBe(before + 1);

    const { releaseItems } = await import('$lib/db/schema');
    await db.insert(releaseItems).values({
      releaseId: id,
      ordinal: 0,
      kind: 'feature',
      impact: 'internal',
      title: 'Something',
      summary: 'Something happened.',
      confidence: 'medium',
    });
    expect(await countPending()).toBe(before);

    await db.delete(releaseItems).where(eq(releaseItems.releaseId, id));
  });
});
