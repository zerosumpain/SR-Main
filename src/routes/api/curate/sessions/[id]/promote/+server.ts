// src/routes/api/curate/sessions/[id]/promote/+server.ts
//
// POST /api/curate/sessions/[id]/promote
// Transitions awaiting-promotion → promoting and kicks runPromote.
// The UI subscribes to the SSE stream for promote-step progress events.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/curate/session-store';
import { transitionStatus, runPromotePhase } from '$lib/curate/engine';

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

  // Fire-and-forget: promote pipeline runs in the background and pushes
  // promote-step SSE events via the event bus as it progresses.
  void runPromotePhase(params.id).catch(() => undefined);

  return json({ sessionId: params.id, status: 'promoting' });
};
