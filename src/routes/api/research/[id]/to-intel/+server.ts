/**
 * Push a finished research session into the intel graph on demand.
 *
 * The extraction already ran automatically at the end of every `investigation`
 * (`worker.ts` calls it after post-processing), but there was no way to trigger
 * it — so a `brief`, a `scan`, or an investigation whose extraction failed had
 * no route back into the graph the rest of jkai reasons over.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { extractResearchIntoIntel } from '$lib/deepdive/intel-bridge';

export const POST: RequestHandler = async ({ params }) => {
  const [session] = await db
    .select({ id: researchSessions.id, status: researchSessions.status })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) return json({ error: 'Session not found' }, { status: 404 });
  if (session.status !== 'complete') {
    return json({ error: 'Research has not finished yet' }, { status: 409 });
  }

  try {
    const outcome = await extractResearchIntoIntel(params.id);
    return json({
      ok: true,
      entities: (outcome as { entities?: number })?.entities ?? 0,
      notes: (outcome as { notes?: number })?.notes ?? 0,
    });
  } catch (err) {
    console.error('[research] intel extraction failed:', err);
    return json({ error: (err as Error)?.message ?? 'Intel extraction failed' }, { status: 500 });
  }
};
