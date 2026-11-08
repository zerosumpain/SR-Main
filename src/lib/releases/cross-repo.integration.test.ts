/**
 * Releases from every repository, joined to sessions without crossing repos.
 *
 * Since 2026-11-08 the porkserv collector records releases for every site
 * repository, and those repositories number their pull requests from 1 too.
 * SR-Main's numeric `pull_requests` join must therefore stay on SR-Main's
 * releases, and a session that opened SR-Drive #67 must link to SR-Drive's
 * release carrying #67 and to nothing of SR-Main's. Run against a real database
 * because the join is SQL; skipped without one, like the other integration tests.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { like } from 'drizzle-orm';
import { db } from '$lib/db';
import { claudeSessions, releases } from '$lib/db/schema';
import { getReleaseSessions } from './sessions.server';
import { getReleaseConsole, parseConsoleFilters } from './console';
import { _resetShowcaseCache, getReleaseShowcase } from './public';

const PREFIX = 'itest_xrepo';
const PR = 98_767; // far above any real PR number, so no real row can join
let dbReady = false;
const ids: Record<string, number> = {};

async function cleanup() {
  await db.delete(claudeSessions).where(like(claudeSessions.id, `${PREFIX}%`));
  await db.delete(releases).where(like(releases.sha, `${PREFIX}%`));
}

function release(sha: string, repo: string) {
  return {
    sha, shortSha: sha.slice(-8), version: `2001.01.01.${sha.length}${sha.slice(-1).charCodeAt(0)}`,
    deployedAt: new Date('2001-01-01T12:00:00Z'), repo, via: 'backfill',
    stats: { commits: 1, files: 1, insertions: 1, deletions: 0, prs: [PR] },
  };
}

beforeAll(async () => {
  try {
    await db.select({ id: releases.id }).from(releases).limit(1);
    dbReady = true;
  } catch {
    return;
  }
  await cleanup();
  const rows = await db.insert(releases).values([
    release(`${PREFIX}_main`, 'zerosumpain/SR-Main'),
    release(`${PREFIX}_drive`, 'zerosumpain/SR-Drive'),
  ]).returning({ id: releases.id, sha: releases.sha });
  for (const r of rows) ids[r.sha.replace(`${PREFIX}_`, '')] = r.id;
  await db.insert(claudeSessions).values([
    { id: `${PREFIX}_main_session`, project: 'strange-rambling-svelte', pullRequests: [PR], pullRequestRefs: [`zerosumpain/sr-main#${PR}`] },
    { id: `${PREFIX}_drive_session`, project: 'sr-drive-lazy-folders-20261104', pullRequests: [], pullRequestRefs: [`zerosumpain/sr-drive#${PR}`] },
  ]);
});

afterAll(async () => {
  if (dbReady) await cleanup();
});

describe('cross-repository release links', () => {
  it('links each session only to the release of the repository it worked in', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);
    const band = await getReleaseSessions([ids.main, ids.drive]);
    expect(band.byRelease[ids.main]).toEqual([`${PREFIX}_main_session`]);
    expect(band.byRelease[ids.drive]).toEqual([`${PREFIX}_drive_session`]);
    // Read through the shared project rules: a deleted Drive worktree is Drive.
    expect(band.sessions.find((s) => s.id === `${PREFIX}_drive_session`)?.project).toBe('sr-drive');
  });

  it('filters the owner console by repository', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);
    const url = new URL('https://example.test/releases?repo=zerosumpain/SR-Drive&from=2001-01-01&to=2001-01-01');
    const console_ = await getReleaseConsole(parseConsoleFilters(url));
    expect(console_.items.map((r) => r.id)).toEqual([ids.drive]);
    expect(console_.items[0].repo).toBe('zerosumpain/SR-Drive');
    expect(console_.repos.map((r) => r.repo)).toEqual(expect.arrayContaining(['zerosumpain/SR-Main', 'zerosumpain/SR-Drive']));
    const all = await getReleaseConsole(parseConsoleFilters(new URL('https://example.test/releases?from=2001-01-01&to=2001-01-01')));
    expect(all.items.map((r) => r.id).sort()).toEqual([ids.main, ids.drive].sort());
  });

  it('keeps every other repository out of the public record', async () => {
    if (!dbReady) return expect(dbReady).toBe(false);
    _resetShowcaseCache();
    const before = await getReleaseShowcase();
    await db.delete(releases).where(like(releases.sha, `${PREFIX}_drive`));
    _resetShowcaseCache();
    const after = await getReleaseShowcase();
    // Removing the SR-Drive row changes nothing a visitor can see.
    expect(after.totals).toEqual(before.totals);
  });
});
