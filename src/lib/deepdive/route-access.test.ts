import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { routeIdsFor } from '$lib/access/catalogue';

/**
 * Every research route a member can reach resolves its rows through the
 * research seam — the P3 precondition, the same shape as intel's
 * route-scope.test.
 *
 * The hook deciding a member may REACH `/api/deepdive/[id]/data` says nothing
 * about which session comes back: without the guard, any id would. So each
 * route file the catalogue opens under `research` must call the guard (by id),
 * the source guard, or `areaAccess` (lists and creates, which filter with
 * `readable`/`writable` and stamp `principalId`).
 */
const GUARDED = /\brequireResearchSession\b|\brequireSourceSession\b|\bareaAccess\b/;

function fileFor(routeId: string): string {
  const dir = `src/routes${routeId}`;
  return existsSync(`${dir}/+server.ts`) ? `${dir}/+server.ts` : `${dir}/+page.server.ts`;
}

describe('every research route a member can reach is scoped', () => {
  const ids = routeIdsFor('research');

  it('finds the routes at all', () => {
    expect(ids.length).toBeGreaterThan(25);
  });

  it('calls the research guard from each', () => {
    const unguarded = ids.filter((id) => !GUARDED.test(readFileSync(fileFor(id), 'utf8')));
    expect(unguarded).toEqual([]);
  });

  it('stamps the caller on every run it creates', () => {
    for (const f of ['src/routes/api/research/+server.ts', 'src/routes/api/deepdive/[id]/explore/+server.ts']) {
      expect(readFileSync(f, 'utf8'), f).toMatch(/principalId:/);
    }
  });

  it('keeps the routes that write into the owner’s own stores closed', () => {
    for (const id of [
      '/api/research/[id]/to-drive',
      '/api/research/[id]/to-intel',
      '/api/deepdive',
      '/api/deepdive/index-sources',
      '/api/deepdive/reindex-facts',
      '/api/deepdive/source-image',
    ]) {
      expect(ids, id).not.toContain(id);
    }
  });
});
