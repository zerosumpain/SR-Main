import type { RequestHandler } from './$types';
import { partyJson, requireTv } from '$lib/games/party-http.server';
import { tvStream } from '$lib/games/party.server';

/** GET /api/games/tv/party/stream — the linked TV's party, then the running game's table (`toScreen`). */
export const GET: RequestHandler = ({ cookies }) =>
  partyJson(async () => {
    const tv = await requireTv(cookies);
    return tvStream(tv);
  });
