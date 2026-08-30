/**
 * "What would be served, and why" — the intelligence most likely to be pulled
 * into a build.
 *
 * This surface exists because retrieval is otherwise unfalsifiable. The build
 * log says a block was injected; it does not say what nearly made the cut, what
 * was demoted, or which term of the score decided it. Without that, a bad
 * ranking is invisible until builds quietly get worse.
 */
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { codegraphEpisodes, codegraphLessons, codegraphQueries } from '$lib/db/schema';
import { and, desc, isNull, sql } from 'drizzle-orm';
import { relevanceOf, rankingRegime } from '$lib/codegraph/relevance';

export const load: PageServerLoad = async () => {
  const [lessonRows, episodeRows] = await Promise.all([
    db.select().from(codegraphLessons)
      .where(and(isNull(codegraphLessons.retiredAt), isNull(codegraphLessons.supersededById)))
      .limit(600),
    db.select().from(codegraphEpisodes).where(isNull(codegraphEpisodes.retiredAt)).limit(400),
  ]);

  const scored = [
    ...lessonRows.map((l) => ({
      kind: 'lesson' as const,
      id: l.id,
      title: l.title,
      detail: (l.citedPaths as string[])?.slice(0, 3).join(', ') || '—',
      served: l.servedCount,
      relevance: relevanceOf({
        served: l.servedCount,
        helpful: l.helpfulCount,
        unhelpful: l.unhelpfulCount,
        // `observedAt` ONLY — never `updatedAt`. updatedAt is when the backfill
        // wrote the row, which is the same instant for all 273 of them, so
        // falling back to it made every lesson look brand new and every score
        // land on an identical 0.500. Ingest clock is not observation clock;
        // unknown age must stay unknown so it can be scored as such.
        observedAt: l.observedAt ?? null,
        stale: Boolean(l.staleAt),
      }),
    })),
    ...episodeRows.map((e) => ({
      kind: 'episode' as const,
      id: e.id,
      title: e.title ?? e.fingerprint ?? 'Change',
      detail: e.fingerprint ?? e.gate ?? '—',
      served: e.servedCount,
      relevance: relevanceOf({
        served: e.servedCount,
        helpful: e.helpfulCount,
        unhelpful: e.unhelpfulCount,
        observedAt: e.occurredAt ?? null,
        // Must match `retrieve.ts` exactly — this page exists to explain the
        // ranking retrieval actually uses, and a surface that scores by
        // different rules is a surface that lies about the system.
        verdict: e.verdict,
      }),
    })),
  ].sort((a, b) => b.relevance.score - a.relevance.score);

  const [{ resolved }] = await db
    // Only serves that produced EVIDENCE count towards ranking maturity.
    // `unattributable` rows are resolved in the sense of being closed, but they
    // measured nothing, and counting them would tell the regime indicator the
    // corpus knows more than it does.
    .execute(
      sql`SELECT count(*)::int AS resolved FROM codegraph_queries WHERE resolution IN ('helpful', 'unhelpful')`,
    )
    .then((r) => r.rows as Array<{ resolved: number }>);

  const totalObservations = scored.reduce((a, s) => a + s.relevance.observations, 0);

  return {
    top: scored.slice(0, 40),
    // The tail matters as much as the head: these are the units the budget will
    // never reach, and seeing them is how you notice something good has decayed
    // or something useless is still being carried.
    bottom: scored.slice(-15).reverse(),
    regime: rankingRegime(totalObservations),
    counts: {
      units: scored.length,
      neverServed: scored.filter((s) => s.served === 0).length,
      atrophying: scored.filter((s) => s.relevance.observations > 0 && s.relevance.outcome < 0.5).length,
      proven: scored.filter((s) => s.relevance.outcome > 0.5).length,
      resolvedServes: Number(resolved ?? 0),
    },
  };
};
