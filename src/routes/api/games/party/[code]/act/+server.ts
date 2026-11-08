import type { RequestHandler } from './$types';
import { partyBody, partyJson, seatedMember } from '$lib/games/party-http.server';
import { memberAct } from '$lib/games/party.server';

/** POST /api/games/party/<CODE>/act `{ action, … }` — a move in the game the TV is playing. */
export const POST: RequestHandler = ({ params, request, cookies, locals }) =>
  partyJson(async () => {
    const memberId = await seatedMember({ cookies, locals }, params.code);
    const body = await partyBody(request);
    return { room: memberAct(params.code, memberId, body.action, body) };
  });
