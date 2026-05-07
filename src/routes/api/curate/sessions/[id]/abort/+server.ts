// src/routes/api/curate/sessions/[id]/abort/+server.ts
//
// POST /api/curate/sessions/[id]/abort
// Ends the session (kills dev server, removes worktree, releases port)
// and marks it aborted.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/curate/session-store';
import { endCuratedSession } from '$lib/curate/session-lifecycle';
import { updateSession } from '$lib/curate/session-store';

const TERMINAL_STATUSES = new Set(['promoted', 'aborted', 'ended']);

export const POST: RequestHandler = async ({ params }) => {
  const session = await getSession(params.id);
  if (!session) throw error(404, `Curate session not found: ${params.id}`);

  if (TERMINAL_STATUSES.has(session.status)) {
    // Already terminal — treat as idempotent success.
    return json({ sessionId: params.id, status: session.status });
  }

  try {
    // endCuratedSession kills server + worktree + releases port + marks ended.
    await endCuratedSession(params.id);
    // Override the 'ended' status with 'aborted' for clarity.
    await updateSession(params.id, { status: 'aborted' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw error(500, `Failed to abort session: ${msg}`);
  }

  return json({ sessionId: params.id, status: 'aborted' });
};
