// src/routes/api/curate/sessions/[id]/redirect/+server.ts
//
// POST /api/curate/sessions/[id]/redirect
// Body: { text: string }
// Transitions awaiting-approval → discovering and re-runs discovery
// with the user's correction appended.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/curate/session-store';
import { transitionStatus, runDiscovery } from '$lib/curate/engine';

export const POST: RequestHandler = async ({ params, request }) => {
  const session = await getSession(params.id);
  if (!session) throw error(404, `Curate session not found: ${params.id}`);

  if (session.status !== 'awaiting-approval') {
    throw error(409, `Cannot redirect: session is '${session.status}', expected 'awaiting-approval'`);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw error(400, 'Missing required field: text');

  try {
    await transitionStatus(params.id, 'awaiting-approval', 'discovering');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw error(500, `State transition failed: ${msg}`);
  }

  // Fire-and-forget: discovery re-runs with the redirect text in the background.
  void runDiscovery(params.id, { redirectText: text }).catch(() => undefined);

  return json({ sessionId: params.id, status: 'discovering', redirect: text });
};
