import type { RequestHandler } from './$types';
import { partyJson } from '$lib/games/party-http.server';
import { partyByCode } from '$lib/games/party.server';

/**
 * GET /api/games/party/<CODE> — what a phone that scanned the TV's QR may
 * know before joining: which TV, what it is playing, who is in. PUBLIC
 * (`/api/games/party` in PUBLIC_PATHS); an unknown code is a 404 sentence.
 */
export const GET: RequestHandler = ({ params }) =>
  partyJson(() => {
    const p = partyByCode(params.code);
    return { party: { code: p.code, tvName: p.tvName, phase: p.phase, locked: p.locked, game: p.game, members: p.members, games: p.games } };
  });
