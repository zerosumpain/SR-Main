import type { RequestHandler } from './$types';
import { withGamesSession } from '$lib/games/site-access.server';
import { roomStream } from '$lib/games/api.server';

/** GET /api/games/[id]/stream — the room as SSE, the same frames the phone reads. */
export const GET: RequestHandler = withGamesSession((event, caller) => roomStream(caller, event.params.id));
