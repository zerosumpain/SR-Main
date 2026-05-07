// src/routes/api/curate/sessions/[id]/+server.ts
//
// GET /api/curate/sessions/[id] — full session row

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/curate/session-store';

export const GET: RequestHandler = async ({ params }) => {
  const session = await getSession(params.id);
  if (!session) throw error(404, `Curate session not found: ${params.id}`);
  return json(session);
};
