import { db } from '$lib/db';
import { jkaiIterations } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

/**
 * Mark any running iterations for the given build as failed.
 * Used during pause, resume, continue, and startup recovery to
 * clean up iterations that were interrupted mid-flight.
 */
export async function failOrphanedIterations(buildId: string): Promise<void> {
  await db
    .update(jkaiIterations)
    .set({ status: 'failed' })
    .where(
      and(
        eq(jkaiIterations.buildId, buildId),
        eq(jkaiIterations.status, 'running'),
      ),
    );
}
