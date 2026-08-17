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
import { resolveServe, serveIsAttributable } from './relevance';

export interface ResolveResult {
  resolved: number;
  outcome: 'helpful' | 'unhelpful' | 'unresolved' | 'none';
  lessons: number;
  episodes: number;
  /** Serves closed without being counted, because nothing was being fixed. */
  unattributable?: number;
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
 * Resolve every still-open serve for a build that COMPLETED successfully.
 *
 * `resolveBuildServes` runs at the start of the next iteration, which never
 * happens when a build gets it right first time — the best outcome there is
 * produced the least evidence, which is exactly backwards. A green final gate
 * and an open PR is the strongest signal available that the context served was
 * the right context.
 *
 * Success path only. A failed build is not evidence against what it was served:
 * builds fail on provider errors, token caps and stalls far more often than on
 * bad context, and counting those as `unhelpful` would punish good intelligence
 * for unrelated infrastructure faults.
 *
 * FINGERPRINTED SERVES ONLY, and this is the load-bearing part.
 *
 * The first version of this credited every open serve on a green finish, which
 * made `helpful` mean "was served to a build that happened to succeed" rather
 * than "helped". A serve keyed on the FILE SET is made before any gate has run:
 * there was no error to address, so a first-pass win says nothing about it —
 * the build would very likely have succeeded with nothing at all. Crediting it
 * is not a weak measurement, it is a measurement of the wrong thing, and it
 * inflates exactly the counters that ranking depends on.
 *
 * `planBuildQuery` already said so at the point of retrieval:
 *
 *     // No fingerprints: a file-set serve cannot be resolved by "did the error
 *     // recur", so it stays unresolved rather than being credited for free.
 *
 * Those serves are closed as `unattributable` — recorded, never counted. Real
 * evidence only ever comes from a serve made in answer to a specific gate
 * error, resolved by whether that error came back.
 */
export async function resolveCompletedBuildServes(buildId: string): Promise<ResolveResult> {
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

  let resolved = 0;
  let lessons = 0;
  let episodes = 0;
  let unattributable = 0;

  for (const q of pending) {
    // An `empty` serve carries nothing; a file-set serve was made before
    // anything had failed. Neither can be shown to have helped by a build
    // finishing green — see `serveIsAttributable`.
    if (!serveIsAttributable({ outcome: q.outcome, servedFor: (q.servedFor as string[]) ?? [] })) {
      // `empty` serves stay open (they may still be resolved by a recurring
      // fingerprint); a fingerprint-less serve never can be, so close it.
      if (q.outcome === 'served') {
        await db
          .update(codegraphQueries)
          .set({ resolution: 'unattributable', resolvedAt: new Date() })
          .where(eq(codegraphQueries.id, q.id));
        unattributable++;
      }
      continue;
    }

    const lessonIds = (q.lessonIds as string[]) ?? [];
    const episodeIds = (q.episodeIds as string[]) ?? [];

    if (lessonIds.length) {
      await db
        .update(codegraphLessons)
        .set({ helpfulCount: sql`${codegraphLessons.helpfulCount} + 1` })
        .where(inArray(codegraphLessons.id, lessonIds));
      lessons += lessonIds.length;
    }
    if (episodeIds.length) {
      await db
        .update(codegraphEpisodes)
        .set({ helpfulCount: sql`${codegraphEpisodes.helpfulCount} + 1` })
        .where(inArray(codegraphEpisodes.id, episodeIds));
      episodes += episodeIds.length;
    }

    await db
      .update(codegraphQueries)
      .set({ resolution: 'helpful', resolvedAt: new Date() })
      .where(eq(codegraphQueries.id, q.id));
    resolved++;
  }

  return { resolved, outcome: resolved ? 'helpful' : 'none', lessons, episodes, unattributable };
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
