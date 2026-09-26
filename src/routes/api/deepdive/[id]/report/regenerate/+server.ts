import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runPostProcessing } from '$lib/deepdive/postprocess';
import { requireResearchSession, reserveResearchStart } from '$lib/deepdive/session-access.server';
import { coerceDepth } from '$lib/deepdive/depth';

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
export const POST: RequestHandler = async (event) => {
  const { params } = event;
  const { session, access } = await requireResearchSession(event, params.id, 'write');

  // Already regenerating this session — don't start a second concurrent run.
  if (inFlight.has(params.id)) {
    return json({ ok: true, alreadyRunning: true }, { status: 202 });
  }
  // A whole post-processing pass: metered for a member like a run.
  await reserveResearchStart(access, coerceDepth(session.depth));
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
