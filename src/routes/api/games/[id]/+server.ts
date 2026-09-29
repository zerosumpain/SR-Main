import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withGamesSession } from '$lib/games/site-access.server';
import { jsonBody, roomAct, roomView } from '$lib/games/api.server';

/** GET /api/games/[id] — one room as this player sees it. */
export const GET: RequestHandler = withGamesSession(async (event, caller) => ({
  room: await roomView(caller, event.params.id),
}));

/**
 * POST /api/games/[id] — `{ action, …the move's fields }`, exactly as the
 * phone posts to `/api/native/games/[id]` (Liar's Dice: `bid` {quantity, face},
 * `liar`). Answers with the room after it.
 */
export const POST: RequestHandler = withGamesSession(async (event, caller) => {
  const body = await jsonBody(event.request);
  if (!body) return json({ error: 'Body must be JSON' }, { status: 400 });
  return { room: await roomAct(caller, event.params.id, body) };
});
