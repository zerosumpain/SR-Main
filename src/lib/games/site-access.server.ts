// The web door into the games rooms: a browser session holding `games:self`
// (the owner always). The phone's door is `withNativeAccess('games', …)`;
// both hand `$lib/games/api.server` an email, so a person is the same player
// on either.
//
// The hook has already let the request past (`memberMayReach` against the
// catalogue's `games` routes); this re-derives the grant through the area's
// own seam, `areaAccess`, so a route file that forgot the catalogue — or a
// catalogue entry that outlived its route — still refuses a guest.

import { error, isHttpError, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { areaAccess } from '$lib/server/area-scope';
import type { GameCaller } from './api.server';

/** The session's player, or a 403 thrown for anyone without `games:self`. */
export async function gamesCaller(event: Pick<RequestEvent, 'locals'>): Promise<GameCaller> {
  const access = await areaAccess(event, 'games');
  const session = await event.locals.auth();
  const email = (session?.user?.email ?? '').trim().toLowerCase();
  // A service caller (no session) reaches OWNER_ACCESS through `serviceAreas`
  // but is nobody at a table.
  if (!email) error(403, 'Forbidden');
  return { email, role: access.level === 'owner' ? 'owner' : 'member' };
}

/**
 * Wrap a `/api/games` handler: resolve the caller, run it, and answer every
 * refusal as `{ error }` with its status — the same vocabulary the phone gets.
 */
export function withGamesSession<E extends RequestEvent, T>(
  handler: (event: E, caller: GameCaller) => Promise<T> | T,
) {
  return async (event: E): Promise<Response> => {
    try {
      const caller = await gamesCaller(event);
      const result = await handler(event, caller);
      if (result instanceof Response) return result;
      return json(result as Record<string, unknown>);
    } catch (err) {
      if (isHttpError(err)) return json({ error: err.body.message }, { status: err.status });
      console.error(`[games] ${event.url.pathname} failed`, err);
      return json({ error: 'Something went wrong. Try again.' }, { status: 500 });
    }
  };
}
