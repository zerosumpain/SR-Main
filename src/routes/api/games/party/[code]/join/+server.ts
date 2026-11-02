import type { RequestHandler } from './$types';
import { familyPlayer, guestJoinAllowed, partyBody, partyJson, setSeatCookie } from '$lib/games/party-http.server';
import { joinFamily, joinGuest, partyIdFor, wasKicked } from '$lib/games/party.server';
import { seatCookie, verifySeat } from '$lib/games/party';
import { env } from '$env/dynamic/private';
import { GameError } from '$lib/games/tap-duel';

/**
 * POST /api/games/party/<CODE>/join `{ name?, guest? }` — sit down at the
 * TV. A family member signed in here joins as themselves (unless `guest`);
 * anybody else joins by name. Either way the browser keeps a seat cookie for
 * this party only. Guest joins are rate-limited per browser.
 */
export const POST: RequestHandler = ({ params, request, cookies, url, locals, getClientAddress }) =>
  partyJson(async () => {
    const body = await partyBody(request);
    // A seat this browser already held here, for somebody the TV took out: they stay out.
    const partyId = partyIdFor(params.code);
    const held = verifySeat(cookies.get(seatCookie(partyId)), partyId, env.AUTH_SECRET);
    if (held && wasKicked(params.code, held)) throw new GameError(403, 'You were taken out of this game on the TV.');
    const family = body.guest === true ? null : await familyPlayer({ locals });
    if (!family && !guestJoinAllowed(request, getClientAddress)) throw new GameError(429, 'Too many joins from here. Wait a few minutes.');
    const joined = family ? joinFamily(params.code, family) : joinGuest(params.code, body.name);
    setSeatCookie(cookies, url, joined.party.id, joined.seat);
    return { party: joined.party, me: { id: joined.memberId } };
  });
