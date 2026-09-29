import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { jsonBody, roomAct, roomView } from '$lib/games/api.server';

/** GET /api/native/games/[id] — one room as this player sees it. */
export const GET: RequestHandler = withNativeAccess('games', async (event, identity, role) => ({
  room: await roomView({ email: identity.ownerEmail, role }, event.params.id),
}));

/**
 * POST /api/native/games/[id] — `{ action, …the move's fields }`.
 * Lobby verbs join | decline | leave | start | again, `invite` {invite: [playerId]}
 * (the host, while the lobby is open), or the game's own move
 * (Tap Duel `tap` {round, reactionMs, early}; Wordle Race `guess` {word}).
 * Answers with the room after it; a `since` (Draw & Guess's drawing revision)
 * asks for the drawing as the changes after it.
 */
export const POST: RequestHandler = withNativeAccess('games', async (event, identity, role) => {
  const body = await jsonBody(event.request);
  if (!body) return json({ error: 'Body must be JSON' }, { status: 400 });
  return { room: await roomAct({ email: identity.ownerEmail, role }, event.params.id, body) };
});
