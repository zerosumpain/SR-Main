import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withGamesSession } from '$lib/games/site-access.server';
import { jsonBody, lobbyFor, startGame } from '$lib/games/api.server';
import { noteWebPlayer } from '$lib/games/players.server';
import { WEB_GAMES } from '$lib/games/web';

/**
 * GET /api/games — the web lobby: the same answer the phone's
 * `/api/native/games` gives, for a browser session with `games:self`.
 *
 * The page polls this every 5 s, like the app. Each poll marks the caller as
 * reachable on the web (`noteWebPlayer`), which is what lets somebody with no
 * paired phone be invited — and this same poll is where they collect it.
 */
export const GET: RequestHandler = withGamesSession(async (_event, caller) => {
  noteWebPlayer(caller.email);
  return lobbyFor(caller);
});

/**
 * POST /api/games — start a game. Same body as the phone's; the web starts
 * only the games it can play (`WEB_GAMES`).
 */
export const POST: RequestHandler = withGamesSession(async (event, caller) => {
  const body = await jsonBody(event.request);
  if (!body) return json({ error: 'Body must be JSON' }, { status: 400 });
  noteWebPlayer(caller.email);
  const room = await startGame(event, caller, body, WEB_GAMES);
  return json({ room }, { status: 201 });
});
