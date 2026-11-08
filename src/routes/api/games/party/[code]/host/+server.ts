import type { RequestHandler } from './$types';
import { partyBody, partyJson, seatedMember } from '$lib/games/party-http.server';
import { hostAct } from '$lib/games/party.server';
import { approvedPacks } from '$lib/games/quiz-packs.server';

/**
 * GET /api/games/party/<CODE>/host — what the host's phone offers beyond the
 * party itself: Kelly's Quiz Night's approved packs (titles only).
 * POST `{ action, … }` — one of the TV's verbs from the host (`HOST_VERBS`):
 * pick, start, go, again, end, kick, lock, unlock. Refused for anybody else.
 */
export const GET: RequestHandler = ({ params, cookies, locals }) =>
  partyJson(async () => {
    await seatedMember({ cookies, locals }, params.code);
    return { packs: await approvedPacks().catch(() => []) };
  });

export const POST: RequestHandler = ({ params, request, cookies, locals }) =>
  partyJson(async () => {
    const memberId = await seatedMember({ cookies, locals }, params.code);
    const body = await partyBody(request);
    return { party: hostAct(params.code, memberId, body.action, body) };
  });
