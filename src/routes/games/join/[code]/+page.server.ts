import type { PageServerLoad } from './$types';
import { familyPlayer, seatedMember } from '$lib/games/party-http.server';
import { partyByCode, seated } from '$lib/games/party.server';
import { GameError } from '$lib/games/tap-duel';

/**
 * /games/join/<CODE> — where the TV's QR lands a phone. PUBLIC (`/games` in
 * PUBLIC_PATHS): a guest has no login. The load says which TV the code is
 * showing (or that none is), whether this browser already holds a seat there
 * and is still in, and who is signed in, so the page opens on the right step.
 * A static segment, so it wins over the sibling `/games/[game]` board.
 */
export const load: PageServerLoad = async ({ params, locals, cookies, request, setHeaders }) => {
  setHeaders({ 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' });
  const ua = request.headers.get('user-agent') ?? '';
  const ios = /iPhone|iPad|iPod/u.test(ua);
  const code = params.code.toUpperCase();

  let party;
  try {
    party = partyByCode(params.code);
  } catch (err) {
    if (!(err instanceof GameError)) throw err;
    return { code, missing: err.message, party: null, me: null, family: null, ios };
  }

  let me: { id: string; name: string; kind: 'family' | 'guest' } | null = null;
  try {
    const id = await seatedMember({ locals, cookies }, party.code);
    me = seated(party.code, id).member;
  } catch (err) {
    if (!(err instanceof GameError)) throw err;
  }

  const family = me ? null : await familyPlayer({ locals }).catch(() => null);

  return {
    code: party.code,
    missing: null,
    // Before a seat, only what the public summary (GET /api/games/party/<CODE>) shows.
    party: { code: party.code, tvName: party.tvName, phase: party.phase, locked: party.locked, game: party.game, members: party.members, games: party.games },
    me,
    family: family ? { name: family.name } : null,
    ios,
  };
};
