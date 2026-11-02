import type { RequestHandler } from './$types';
import { partyJson, seatedMember } from '$lib/games/party-http.server';
import { memberStream } from '$lib/games/party.server';

/** GET /api/games/party/<CODE>/stream — the party, then this player's own view of the running game. */
export const GET: RequestHandler = ({ params, cookies, locals }) =>
  partyJson(async () => {
    const memberId = await seatedMember({ cookies, locals }, params.code);
    return memberStream(params.code, memberId);
  });
