import { describe, expect, it } from 'vitest';
import { backfillBuildLessons, type Queryable } from '../../scripts/backfill-build-lessons';
import { readBuildLesson } from '../../src/lib/codegraph/build-lessons';

/** An in-memory stand-in for the three tables the backfill touches. No database. */
function fakeDb(legacy: Array<Record<string, unknown>>, graph = new Map<string, Record<string, unknown>>()) {
  const links: Array<[string, string]> = [];
  const nodes = new Map([['src/routes/news/+page.svelte', 'node-1']]);
  const db: Queryable = {
    async query(text, params = []) {
      if (text.startsWith('SELECT l.id')) return { rows: legacy };
      if (text.startsWith('SELECT 1 FROM codegraph_lessons')) return { rows: graph.has(params[0] as string) ? [{}] : [] };
      if (text.startsWith('INSERT INTO codegraph_lessons')) {
        const [id, repo, slug, title, body, origin, originRef, paths, observedAt] = params as string[];
        if (graph.has(id)) return { rows: [] };
        graph.set(id, { id, repo, slug, title, body, origin, originRef, citedPaths: JSON.parse(paths), observedAt });
        return { rows: [{ id }] };
      }
      if (text.startsWith('INSERT INTO codegraph_node_lessons')) {
        const out = (params[1] as string[]).flatMap((p) => nodes.has(p) ? [nodes.get(p)!] : [])
          .filter((n) => !links.some(([a, b]) => a === n && b === params[0]));
        for (const n of out) links.push([n, params[0] as string]);
        return { rows: out.map((node_id) => ({ node_id })) };
      }
      throw new Error(`unexpected query: ${text.slice(0, 40)}`);
    },
  };
  return { db, graph, links };
}

const LEGACY = [
  { id: 3, build_id: 'b1', lesson: 'Read the news shell first', evidence: 'See src/routes/news/+page.svelte', revision: 'abc123', created_at: '2026-09-01T10:00:00.000Z', files: ['src/routes/news/+page.svelte'] },
  { id: 4, build_id: 'gone', lesson: 'Undelivered', evidence: 'No delivery row', revision: 'def456', created_at: '2026-09-02T10:00:00.000Z', files: [] },
];

describe('backfill-build-lessons', () => {
  it('reports without writing on a dry run', async () => {
    const { db, graph } = fakeDb(LEGACY);
    await expect(backfillBuildLessons(db, { apply: false })).resolves.toEqual({ scanned: 2, inserted: 2, existing: 0, linked: 0, apply: false });
    expect(graph.size).toBe(0);
  });

  it('copies every legacy row as an unverified build lesson under the identity the sync used, and links its files', async () => {
    const { db, graph, links } = fakeDb(LEGACY);
    await expect(backfillBuildLessons(db, { apply: true })).resolves.toMatchObject({ inserted: 2, existing: 0, linked: 1 });
    const row = graph.get('development-lesson:3')!;
    expect(row).toMatchObject({ origin: 'build', originRef: '/jkai/develop/b1', slug: 'development-lesson:3', citedPaths: ['src/routes/news/+page.svelte'] });
    const read = readBuildLesson({ id: 'development-lesson:3', title: String(row.title), body: String(row.body), observedAt: new Date(String(row.observedAt)), createdAt: new Date(), staleAt: null });
    expect(read).toMatchObject({ lesson: 'Read the news shell first', evidence: 'See src/routes/news/+page.svelte', revision: 'abc123', unverified: true, stale: false });
    // The old 90-day expiry, measured from when the lesson was written.
    expect(read.expiresAt).toBe('2026-11-30T10:00:00.000Z');
    expect(links).toEqual([['node-1', 'development-lesson:3']]);
  });

  it('is idempotent and leaves a copy the sync already made untouched', async () => {
    const synced = { id: 'development-lesson:3', body: 'already synced', retiredAt: '2026-09-20', retiredReason: 'owner forgot it' };
    const { db, graph } = fakeDb(LEGACY, new Map([[synced.id, synced]]));
    await expect(backfillBuildLessons(db, { apply: true })).resolves.toMatchObject({ inserted: 1, existing: 1 });
    // A tombstone is never overwritten by a backfill.
    expect(graph.get('development-lesson:3')).toBe(synced);
    await expect(backfillBuildLessons(db, { apply: true })).resolves.toMatchObject({ inserted: 0, existing: 2, linked: 0 });
  });
});
