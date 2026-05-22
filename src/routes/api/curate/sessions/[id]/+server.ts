// src/routes/api/curate/sessions/[id]/+server.ts
//
// GET    /api/curate/sessions/[id] — full session row
// DELETE /api/curate/sessions/[id] — hard-delete a curate session row

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/curate/session-store';
import { db } from '$lib/db';
import { curateSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const session = await getSession(params.id);
  if (!session) throw error(404, `Curate session not found: ${params.id}`);
  return json(session);
};

export const DELETE: RequestHandler = async ({ params }) => {
  const session = await getSession(params.id);
  if (!session) throw error(404, `Curate session not found: ${params.id}`);
  // Worktree on disk (if any) is reaped lazily by ../reaper.ts; deleting the
  // row here is enough for the UI to drop it. We deliberately don't block on
  // disk cleanup since worktrees can be tens of MB and the reaper runs hourly.
  await db.delete(curateSessions).where(eq(curateSessions.id, params.id));
  return json({ ok: true });
};
