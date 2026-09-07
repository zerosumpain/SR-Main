import { db } from '$lib/db';
import { jkaiIterations } from '$lib/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
/** Bounded iteration detail, with totals across the whole build (including retries). */
export async function developmentProgress(buildId: string) {
  const [totals] = await db.select({ totalTokens: sql<number>`coalesce(sum(${jkaiIterations.tokensUsed}), 0)`.mapWith(Number),
    outputTokens: sql<number>`coalesce(sum(${jkaiIterations.outputTokens}), 0)`.mapWith(Number),
  }).from(jkaiIterations).where(eq(jkaiIterations.buildId, buildId));
  const iterations = await db.select({ id: jkaiIterations.id, number: jkaiIterations.number, status: jkaiIterations.status,
    goals: sql<string | null>`left(${jkaiIterations.goals}, 2000)`, evaluation: sql<string | null>`left(${jkaiIterations.evaluation}, 3000)`,
    nextSteps: sql<string | null>`left(${jkaiIterations.nextSteps}, 2000)`, tokensUsed: jkaiIterations.tokensUsed,
    outputTokens: jkaiIterations.outputTokens, durationMs: jkaiIterations.durationMs, createdAt: jkaiIterations.createdAt,
  }).from(jkaiIterations).where(eq(jkaiIterations.buildId, buildId)).orderBy(desc(jkaiIterations.number)).limit(12);
  return { ...totals, iterations };
}
