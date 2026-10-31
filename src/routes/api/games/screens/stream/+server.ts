import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GameError } from '$lib/games/tap-duel';
import { screenStream } from '$lib/games/screens.server';

/**
 * GET /api/games/screens/stream?game=<id>[&ticket=…] — a TV board's one
 * stream (`$lib/games/screens.server`). PUBLIC (`/api/games/screens` in
 * PUBLIC_PATHS): a TV has no login. Without a ticket it is given a code to
 * show; a player types the code on their phone, and the same stream then
 * carries a ticket and the room's table (`toScreen`) — public information
 * only. A ticket that is forged, expired, or whose room has gone is answered
 * with `ended` and a fresh code.
 */
export const GET: RequestHandler = async ({ url }) => {
  try {
    return await screenStream(url.searchParams.get('game'), url.searchParams.get('ticket'));
  } catch (err) {
    if (err instanceof GameError) return json({ error: err.message }, { status: err.status });
    throw err;
  }
};
