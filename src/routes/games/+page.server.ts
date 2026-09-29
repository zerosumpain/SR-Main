import type { PageServerLoad } from './$types';
import { gamesCaller } from '$lib/games/site-access.server';
import { lobbyFor } from '$lib/games/api.server';
import { noteWebPlayer } from '$lib/games/players.server';

/**
 * The web lobby's first paint: the same `lobbyFor` the page then polls from
 * `/api/games` every 5 s. Opening it marks the reader as reachable on the web
 * (`noteWebPlayer`), so the family can invite them without a paired phone.
 */
export const load: PageServerLoad = async (event) => {
  const caller = await gamesCaller(event);
  noteWebPlayer(caller.email);
  return { lobby: await lobbyFor(caller) };
};
