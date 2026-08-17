/**
 * Closing the loop: what was a serve actually worth?
 *
 * Retrieval without feedback is a guess that never learns. This is the half
 * that makes `relevance.ts` mean anything — without it, `helpful` and
 * `unhelpful` stay at zero forever, every unit sits at the neutral prior, and
 * ranking never leaves its recency bias.
 *
 * WHEN THIS RUNS
 *
 * At the START of iteration N+1, resolving the serve made at iteration N. That
 * is the earliest moment the answer exists: the gate has run, and its
 * diagnostics are in the previous iteration's evaluation. Trying to resolve at
 * the end of iteration N would mean guessing at a gate that had not run yet.
 *
 * WHAT IT REFUSES TO DO
 *
 * Nothing here asks a model whether the context was useful. The signal is the
 * gate: did the fingerprint that triggered the retrieval come back? A model's
 * opinion would be unfalsifiable, and a wrong `helpful` is indistinguishable
 * from a real one the moment it is written — it would bias every future
 * ranking with no way to detect or undo it. An unresolvable serve stays
 * unresolved, which is why `served` is always larger than `helpful+unhelpful`.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { codegraphEpisodes, codegraphLessons, codegraphQueries } from '$lib/db/schema';
import { fingerprintsIn } from './fingerprint';
import { resolveServe } from './relevance';

export interface ResolveResult {
  resolved: number;
  outcome: 'helpful' | 'unhelpful' | 'unresolved' | 'none';
  lessons: number;
  episodes: number;
}

/**
 * Resolve every unresolved push-serve for this build against what the gate said
 * next, and fold the result into the served units' evidence.
 *
 * `nextEvaluation` is the previous iteration's evaluation text — the
 * orchestrator has already appended the gate diagnostics to it.
 */
export async function resolveBuildServes(input: {
  buildId: string;
  nextEvaluation: string | null;
  nextGatePassed: boolean | null;
}): Promise<ResolveResult> {
  const { buildId, nextEvaluation, nextGatePassed } = input;

  const pending = await db
    .select()
    .from(codegraphQueries)
    .where(
      and(
        eq(codegraphQueries.buildId, buildId),
        eq(codegraphQueries.channel, 'push'),
        isNull(codegraphQueries.resolution),
      ),
    )
    .limit(20);

  if (!pending.length) return { resolved: 0, outcome: 'none', lessons: 0, episodes: 0 };

  const nextFingerprints =
    nextEvaluation === null ? null : fingerprintsIn(nextEvaluation, 'npm run gate');

  let resolved = 0;
  let lessons = 0;
  let episodes = 0;
  let lastOutcome: ResolveResult['outcome'] = 'unresolved';

  for (const q of pending) {
    const outcome = resolveServe({
      servedFor: (q.servedFor as string[]) ?? [],
      nextFingerprints,
      nextGatePassed,
    });
    lastOutcome = outcome;
    if (outcome === 'unresolved') continue;

    const lessonIds = (q.lessonIds as string[]) ?? [];
    const episodeIds = (q.episodeIds as string[]) ?? [];
    const helpful = outcome === 'helpful';

    // Increment in SQL, not read-modify-write: two iterations of two builds can
    // resolve at the same moment and a client-side += would lose one.
    if (lessonIds.length) {
      await db
        .update(codegraphLessons)
        .set(
          helpful
            ? { helpfulCount: sql`${codegraphLessons.helpfulCount} + 1` }
            : { unhelpfulCount: sql`${codegraphLessons.unhelpfulCount} + 1` },
        )
        .where(inArray(codegraphLessons.id, lessonIds));
      lessons += lessonIds.length;
    }
    if (episodeIds.length) {
      await db
        .update(codegraphEpisodes)
        .set(
          helpful
            ? { helpfulCount: sql`${codegraphEpisodes.helpfulCount} + 1` }
            : { unhelpfulCount: sql`${codegraphEpisodes.unhelpfulCount} + 1` },
        )
        .where(inArray(codegraphEpisodes.id, episodeIds));
      episodes += episodeIds.length;
    }

    await db
      .update(codegraphQueries)
      .set({ resolution: outcome, resolvedAt: new Date() })
      .where(eq(codegraphQueries.id, q.id));
    resolved++;
  }

  return { resolved, outcome: lastOutcome, lessons, episodes };
}

/**
 * Record that these units were served, at the moment of serving.
 *
 * Separate from the outcome counters on purpose: `served` says the graph spent
 * budget, `helpful`/`unhelpful` say whether the spend was worth it. Collapsing
 * them would make "served a lot" look like "worked a lot", which is exactly the
 * confusion the tool bridge's self-reported health caused.
 */
export async function recordServed(input: {
  lessonIds: string[];
  episodeIds: string[];
}): Promise<void> {
  const now = new Date();
  if (input.lessonIds.length) {
    await db
      .update(codegraphLessons)
      .set({ servedCount: sql`${codegraphLessons.servedCount} + 1`, lastServedAt: now })
      .where(inArray(codegraphLessons.id, input.lessonIds));
  }
  if (input.episodeIds.length) {
    await db
      .update(codegraphEpisodes)
      .set({ servedCount: sql`${codegraphEpisodes.servedCount} + 1`, lastServedAt: now })
      .where(inArray(codegraphEpisodes.id, input.episodeIds));
  }
}
