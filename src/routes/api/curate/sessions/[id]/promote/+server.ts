// src/routes/api/curate/sessions/[id]/promote/+server.ts
//
// POST /api/curate/sessions/[id]/promote
// Transitions awaiting-promotion → promoting and kicks runPromote.
// The UI subscribes to the SSE stream for promote-step progress events.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/curate/session-store';
import { transitionStatus } from '$lib/curate/engine';

export const POST: RequestHandler = async ({ params }) => {
  const session = await getSession(params.id);
  if (!session) throw error(404, `Curate session not found: ${params.id}`);

  if (session.status !== 'awaiting-promotion') {
    throw error(409, `Cannot promote: session is '${session.status}', expected 'awaiting-promotion'`);
  }

  try {
    await transitionStatus(params.id, 'awaiting-promotion', 'promoting');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw error(500, `State transition failed: ${msg}`);
  }

  // TODO(curate-phase-7): kick the promote pipeline in the background
  //   engine.runPromote(params.id).catch(() => undefined);
  // promote-step events will stream via SSE (pushEvent calls in runPromote).

  return json({ sessionId: params.id, status: 'promoting' });
};
