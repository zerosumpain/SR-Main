import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { GAMES, isGameId } from '$lib/games/catalogue';
import { TITLES } from '$lib/games/invite-push.server';

/**
 * /games/<game> — the TV board for a family game, cast to the television.
 *
 * Public by design (`/games` in PUBLIC_PATHS): a TV has no login. The page
 * holds nothing until a player in a room pairs it by typing the code it
 * shows; after that it follows that one room with a ticket
 * (`$lib/games/screens`), seeing only the game's `toScreen` — the table
 * everybody in the room can already see. A game with no TV board is a 404.
 */
export const load: PageServerLoad = async ({ params, setHeaders }) => {
  if (!isGameId(params.game) || !GAMES[params.game].toScreen) error(404, 'There is no TV board for that game.');
  setHeaders({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
  return { game: params.game, title: TITLES[params.game] };
};
