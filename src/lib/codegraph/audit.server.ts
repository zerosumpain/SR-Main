import { db } from '$lib/db';
import { codegraphQueries } from '$lib/db/schema';
export async function logContextAttempt(input: { buildId: string; iterationId?: string; outcome: 'skipped' | 'failed'; reason: string }) {
  await db.insert(codegraphQueries).values({ channel: 'push', buildId: input.buildId, iterationId: input.iterationId,
    query: '', outcome: input.outcome, errorMessage: input.outcome === 'failed' ? input.reason.slice(0, 500) : null,
    evidence: { reason: input.reason, policyVersion: 'context-v2' } });
}
