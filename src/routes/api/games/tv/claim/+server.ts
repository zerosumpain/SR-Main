import type { RequestHandler } from './$types';
import { partyBody, partyJson, setTvCookie } from '$lib/games/party-http.server';
import { GameError } from '$lib/games/tap-duel';
import { tvFromToken } from '$lib/games/tv-devices.server';

/**
 * POST /api/games/tv/claim `{ token }` — the TV keeps the token its link
 * stream handed it, as the httpOnly `sr_tv` cookie. Only a token for a TV
 * that is linked now is kept; anything else is a 401.
 */
export const POST: RequestHandler = ({ request, cookies, url }) =>
  partyJson(async () => {
    const { token } = await partyBody(request);
    const tv = typeof token === 'string' ? await tvFromToken(token) : null;
    if (!tv || typeof token !== 'string') throw new GameError(401, 'That link has not been approved.');
    // The token's second part is its expiry, in seconds (`$lib/games/party` issueTvToken).
    setTvCookie(cookies, url, token, Number(token.split('.')[1]) * 1000);
    return { ok: true, name: tv.name };
  });
