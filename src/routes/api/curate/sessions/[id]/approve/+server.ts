// src/routes/api/curate/sessions/[id]/approve/+server.ts
//
// POST /api/curate/sessions/[id]/approve
// Transitions awaiting-approval → generating and kicks runGenerate.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/curate/session-store';
import { transitionStatus, runGeneratePhase } from '$lib/curate/engine';

export const POST: RequestHandler = async ({ params }) => {
  const session = await getSession(params.id);
  if (!session) throw error(404, `Curate session not found: ${params.id}`);

  if (session.status !== 'awaiting-approval') {
    throw error(409, `Cannot approve: session is '${session.status}', expected 'awaiting-approval'`);
  }

  try {
    await transitionStatus(params.id, 'awaiting-approval', 'generating');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw error(500, `State transition failed: ${msg}`);
  }

  // Fire-and-forget: generate + live-test chain runs in the background.
  // The UI subscribes to SSE for phase and test-result events.
  void runGeneratePhase(params.id).catch(() => undefined);

  return json({ sessionId: params.id, status: 'generating' });
};
