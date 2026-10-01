/** Observed check outcomes, not causal claims about the retrieved guidance. */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { codegraphEpisodes, codegraphLessons, codegraphQueries } from '$lib/db/schema';
import { fingerprintsIn } from './fingerprint';
import { resolveServe } from './relevance';

export interface ResolveResult {
  resolved: number;
  outcome: 'helpful' | 'unhelpful' | 'unresolved' | 'unattributable' | 'none';
  lessons: number; episodes: number; unattributable?: number;
}

/**
 * The channels whose rows a gate receipt can judge.
 *
 * `push` alone until 2026-10: a fingerprint the AGENT asked about
 * (`fingerprint:typecheck:TS2345` over the pull script) is the same claim as
 * one the executor pushed — "here is what history says about this error" — and
 * "did that error recur at the next gate" answers it the same way. The rule
 * does not loosen: `resolveServe` still closes anything without fingerprints
 * in `servedFor` as `unattributable`, so a `file:` or `topic:` pull earns no
 * credit. `chat` and `precedent` stay out — neither belongs to an iteration.
 */
export const RESOLVABLE_CHANNELS = ['push', 'pull'] as const;

/** Lock and resolve the exact iteration's injected evidence in one transaction. */
export async function resolveBuildServes(input: {
  buildId: string; iterationId?: string; nextEvaluation: string | null; nextGatePassed: boolean | null;
  revision?: string; gate?: string;
}): Promise<ResolveResult> {
  return db.transaction(async tx => {
    const pending = await tx.select().from(codegraphQueries).where(and(
      eq(codegraphQueries.buildId, input.buildId), inArray(codegraphQueries.channel, [...RESOLVABLE_CHANNELS]),
      isNull(codegraphQueries.resolution),
      input.iterationId ? eq(codegraphQueries.iterationId, input.iterationId) : undefined,
    )).orderBy(codegraphQueries.createdAt).limit(100).for('update');
    const result: ResolveResult = { resolved: 0, outcome: 'none', lessons: 0, episodes: 0, unattributable: 0 };
    const nextFingerprints = input.nextEvaluation === null ? null : fingerprintsIn(input.nextEvaluation, input.gate ?? 'npm run gate');
    for (const q of pending) {
      const outcome = resolveServe({ outcome: q.outcome, servedFor: q.servedFor, nextFingerprints, nextGatePassed: input.nextGatePassed });
      if (outcome === 'unresolved') continue;
      result.outcome = outcome;
      await tx.update(codegraphQueries).set({ resolution: outcome, resolvedAt: new Date(),
        evidence: { ...q.evidence, observation: { kind: 'gate', passed: input.nextGatePassed, revision: input.revision ?? null,
          gate: input.gate ?? null, interpretation: 'Correlation with error recurrence; not proof of causal benefit.' } },
      }).where(eq(codegraphQueries.id, q.id));
      if (outcome === 'unattributable') { result.unattributable!++; continue; }
      for (const [table, ids] of [[codegraphLessons, q.lessonIds], [codegraphEpisodes, q.episodeIds]] as const) {
        if (!ids.length) continue;
        await tx.update(table).set(outcome === 'helpful'
          ? { helpfulCount: sql`${table.helpfulCount} + 1` }
          : { unhelpfulCount: sql`${table.unhelpfulCount} + 1` }).where(inArray(table.id, ids));
      }
      result.lessons += q.lessonIds.length; result.episodes += q.episodeIds.length; result.resolved++;
    }
    return result;
  });
}

/** Legacy terminal caller; normal builds resolve at their structured gate receipt. */
export function resolveCompletedBuildServes(buildId: string) {
  return resolveBuildServes({ buildId, nextEvaluation: '', nextGatePassed: true });
}
export async function recordServed(input: { lessonIds: string[]; episodeIds: string[] }): Promise<void> {
  await db.transaction(async tx => {
    for (const [table, ids] of [[codegraphLessons, input.lessonIds], [codegraphEpisodes, input.episodeIds]] as const) {
      if (ids.length) await tx.update(table).set({ servedCount: sql`${table.servedCount} + 1`, lastServedAt: new Date() }).where(inArray(table.id, ids));
    }
  });
}
