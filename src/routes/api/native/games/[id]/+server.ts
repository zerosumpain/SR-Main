import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { playerFor } from '$lib/games/players.server';
import { act, asHttp, roomFor, ACTIONS, type Action } from '$lib/games/rooms.server';

/** GET /api/native/games/[id] — one room as this player sees it. */
export const GET: RequestHandler = withNativeAccess('games', async (event, identity) => {
  const me = await playerFor(identity.ownerEmail);
  return { room: asHttp(() => roomFor(event.params.id, me.id)) };
});

/**
 * POST /api/native/games/[id] — `{ action, round?, reactionMs?, early? }`.
 * join | decline | leave | start | tap | again. Answers with the room after it.
 */
export const POST: RequestHandler = withNativeAccess('games', async (event, identity) => {
  const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: 'Body must be JSON' }, { status: 400 });
  const action = body.action;
  if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) error(400, 'Unknown action.');

  const me = await playerFor(identity.ownerEmail);
  const room = asHttp(() =>
    act(event.params.id, me.id, action as Action, {
      round: typeof body.round === 'number' ? body.round : undefined,
      reactionMs: typeof body.reactionMs === 'number' ? body.reactionMs : null,
      early: body.early === true,
    }),
  );
  return { room };
});
