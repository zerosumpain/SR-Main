// Counts for the Codegraph nav.
//
// The nav is on every codegraph surface, so this runs on every page load —
// which is why it is COUNT queries and nothing else. Anything expensive (the
// map's adjacency build, a retrieval) stays on the page that owns it. The
// sibling Intel layout learned this the same way: a nav badge must never cost
// an analytics run.
import type { LayoutServerLoad } from './$types';
import { db } from '$lib/db';
import { codegraphEpisodes, codegraphLessons, codegraphNodes, codegraphQueries } from '$lib/db/schema';
import { and, count, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';

export const load: LayoutServerLoad = async () => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [nodes, lessons, episodes, verified, stale, retired, serves, empties] = await Promise.all([
    db.select({ n: count() }).from(codegraphNodes).where(isNull(codegraphNodes.mergedIntoId)),
    db.select({ n: count() }).from(codegraphLessons).where(isNull(codegraphLessons.retiredAt)),
    db.select({ n: count() }).from(codegraphEpisodes).where(isNull(codegraphEpisodes.retiredAt)),
    db.select({ n: count() }).from(codegraphEpisodes)
      .where(and(isNull(codegraphEpisodes.retiredAt), eq(codegraphEpisodes.verdict, 'verified'))),
    db.select({ n: count() }).from(codegraphLessons)
      .where(and(isNull(codegraphLessons.retiredAt), isNotNull(codegraphLessons.staleAt))),
    db.select({ n: count() }).from(codegraphLessons).where(isNotNull(codegraphLessons.retiredAt)),
    db.select({ n: count() }).from(codegraphQueries).where(gte(codegraphQueries.createdAt, since)),
    db.select({ n: count() }).from(codegraphQueries)
      .where(and(gte(codegraphQueries.createdAt, since), eq(codegraphQueries.outcome, 'empty'))),
  ]);

  return {
    codegraphCounts: {
      nodes: nodes[0]?.n ?? 0,
      lessons: lessons[0]?.n ?? 0,
      episodes: episodes[0]?.n ?? 0,
      verified: verified[0]?.n ?? 0,
      stale: stale[0]?.n ?? 0,
      retired: retired[0]?.n ?? 0,
      servesLast7d: serves[0]?.n ?? 0,
      emptyLast7d: empties[0]?.n ?? 0,
    },
  };
};
