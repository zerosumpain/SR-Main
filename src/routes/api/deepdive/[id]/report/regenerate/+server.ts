import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { runPostProcessing } from '$lib/deepdive/postprocess';

// Sessions with a regenerate currently in flight. Guards against overlapping
// runs (e.g. a poll-cap-then-manual-retry) double-dispatching runPostProcessing
// for the same session, which would race on the final `report` write.
const inFlight = new Set<string>();

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

  // Already regenerating this session — don't start a second concurrent run.
  if (inFlight.has(params.id)) {
    return json({ ok: true, alreadyRunning: true }, { status: 202 });
  }
  inFlight.add(params.id);

  // Fire-and-forget — do NOT await (mirrors startResearch / runSynthesis kickoff).
  runPostProcessing(params.id, session)
    .catch((err) => {
      console.error(`[deepdive] report regenerate (runPostProcessing) crashed for ${params.id}:`, err);
    })
    .finally(() => {
      inFlight.delete(params.id);
    });

  return json({ ok: true }, { status: 202 });
};
