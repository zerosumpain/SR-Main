import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { jsonBody, lobbyFor, startGame } from '$lib/games/api.server';

/**
 * GET /api/native/games — the lobby: who I am, who I can invite, what I am
 * invited to, and the games I am in.
 *
 * The phone polls this every few seconds while the app is open. An invite
 * is pushed when it is sent (`invite-push.server`); one the push reached
 * carries `pushed: true` and the app lists it without a second banner. One
 * with no push (no token, Apple refused) still rings from this poll.
 *
 * The bodies live in `$lib/games/api.server`, shared with the web door
 * (`/api/games`) so both play in the same rooms as the same player.
 */
export const GET: RequestHandler = withNativeAccess('games', async (_event, identity, role) =>
  lobbyFor({ email: identity.ownerEmail, role }),
);

/**
 * POST /api/native/games — start a game: `{ game, difficulty, invite: [playerId] }`,
 * plus `topic` (optional) and `audience` (kids | family | adults) for Quiz Night, and
 * `size` (4 | 5 | 6), `seconds` (30 | 90 | 120 | 180) and `scoring` (classic | every)
 * for Boggle, and `categoryCount` (6 | 8 | 10) and `seconds` (90 | 120 | 180) for
 * Categories, `dice` (3 | 5) for Liar's Dice, and `turnsEach` (1 | 2) with `seconds`
 * (60 | 80 | 100) for Draw & Guess — an unknown value is that game's default.
 */
export const POST: RequestHandler = withNativeAccess('games', async (event, identity, role) => {
  const body = await jsonBody(event.request);
  if (!body) return json({ error: 'Body must be JSON' }, { status: 400 });
  const room = await startGame(event, { email: identity.ownerEmail, role }, body);
  return json({ room }, { status: 201 });
});
