import { isHttpError } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { gamesCaller } from '$lib/games/site-access.server';
import { roomView } from '$lib/games/api.server';
import { noteWebPlayer } from '$lib/games/players.server';

/**
 * A table's first paint. A room that is gone, or not this reader's, is not a
 * page error: it renders as "that game has finished" with the way back, the
 * sentence the phone shows.
 */
export const load: PageServerLoad = async (event) => {
  const caller = await gamesCaller(event);
  noteWebPlayer(caller.email);
  try {
    return { id: event.params.id, room: await roomView(caller, event.params.id), refusal: null };
  } catch (err) {
    if (isHttpError(err) && err.status < 500) {
      return { id: event.params.id, room: null, refusal: err.body.message };
    }
    throw err;
  }
};
