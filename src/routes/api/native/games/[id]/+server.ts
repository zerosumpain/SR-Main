import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { gamePlayers, playerFor } from '$lib/games/players.server';
import { act, asHttp, inviteTo, roomFor } from '$lib/games/rooms.server';
import { pushInvites } from '$lib/games/invite-push.server';

/** GET /api/native/games/[id] — one room as this player sees it. */
export const GET: RequestHandler = withNativeAccess('games', async (event, identity) => {
  const me = await playerFor(identity.ownerEmail);
  return { room: asHttp(() => roomFor(event.params.id, me.id)) };
});

/**
 * POST /api/native/games/[id] — `{ action, …the move's fields }`.
 * Lobby verbs join | decline | leave | start | again, `invite` {invite: [playerId]}
 * (the host, while the lobby is open), or the game's own move
 * (Tap Duel `tap` {round, reactionMs, early}; Wordle Race `guess` {word}).
 * Answers with the room after it; a `since` (Draw & Guess's drawing revision)
 * asks for the drawing as the changes after it.
 */
export const POST: RequestHandler = withNativeAccess('games', async (event, identity) => {
  const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: 'Body must be JSON' }, { status: 400 });
  const action = body.action;
  if (typeof action !== 'string') error(400, 'Unknown action.');

  const me = await playerFor(identity.ownerEmail);
  if (action === 'invite') {
    // Resolved against the same roster a new game's invites are, so nobody
    // without games access — or without a paired phone — can be named.
    const ids = Array.isArray(body.invite) ? body.invite.filter((x): x is string => typeof x === 'string') : [];
    if (!ids.length) error(400, 'Pick somebody to invite.');
    const roster = new Map((await gamePlayers()).map((p) => [p.id, p]));
    const people = ids.map((id) => {
      const p = roster.get(id);
      if (!p) error(400, 'One of those players cannot be invited.');
      return { id: p.id, name: p.name };
    });
    const room = asHttp(() => inviteTo(event.params.id, me.id, people));
    void pushInvites(event.params.id);
    return { room };
  }
  const room = asHttp(() => act(event.params.id, me.id, action, body));
  // "Play again" re-invites everybody; their phones are rung afresh.
  if (action === 'again') void pushInvites(event.params.id);
  return { room };
});
