import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { runPostProcessing } from '$lib/deepdive/postprocess';

/**
 * POST /api/deepdive/[id]/report/regenerate
 * Re-runs post-processing (rewrites researchSessions.report) in the background
 * so the report reflects current facts (incl. post-load synthesis).
 * Fire-and-forget; progress is visible via the existing SSE status/log stream.
 */
export const POST: RequestHandler = async ({ params }) => {
  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) {
    return json({ error: 'Session not found' }, { status: 404 });
  }

  // Fire-and-forget — do NOT await (mirrors startResearch / runSynthesis kickoff).
  runPostProcessing(params.id, session).catch((err) => {
    console.error(`[deepdive] report regenerate (runPostProcessing) crashed for ${params.id}:`, err);
  });

  return json({ ok: true }, { status: 202 });
};
