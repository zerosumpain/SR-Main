import { latestRepoVerification } from '$lib/verification/repo';
import { db } from '$lib/db';
import { jkaiIterations, jkaiLogs } from '$lib/db/schema';
import { and, desc, eq, inArray, like, sql } from 'drizzle-orm';
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
  const evidence = await db.select({ id: jkaiLogs.id, type: jkaiLogs.type, content: jkaiLogs.content, createdAt: jkaiLogs.createdAt })
    .from(jkaiLogs).where(and(eq(jkaiLogs.buildId, buildId), inArray(jkaiLogs.type, ['verification', 'stage']))).orderBy(desc(jkaiLogs.id)).limit(80);
  const [failure] = await db.select({ content: sql<string>`left(${jkaiLogs.content}, 5000)`, createdAt: jkaiLogs.createdAt })
    .from(jkaiLogs).where(and(eq(jkaiLogs.buildId, buildId), eq(jkaiLogs.type, 'error'), like(jkaiLogs.content, 'FAIL Tests:%'))).orderBy(desc(jkaiLogs.id)).limit(1);
  let stage: { stage: string; message?: string; iteration?: number } | null = null;
  try { const row = evidence.find(row => row.type === 'stage'); const value = row && JSON.parse(row.content); if (typeof value?.stage === 'string') stage = value; } catch { /* Legacy rows can lack structured state. */ }
  return { ...totals, iterations, verification: latestRepoVerification(evidence), stage, testFailure: failure ?? null };
}
