import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { gamePlayers, playerFor } from '$lib/games/players.server';
import { asHttp, canCreate, createGame, invitesFor, roomsFor } from '$lib/games/rooms.server';
import { isDifficulty, MAX_PLAYERS } from '$lib/games/tap-duel';
import { isGameId } from '$lib/games/catalogue';
import { cleanTopic, isAudience, isClean } from '$lib/games/quiz-night';
import { reserveUsage } from '$lib/jkai/chat-access.server';
import { areaAccess } from '$lib/server/area-scope';

/** Quiz Nights a member may start per rolling 24 h — each is one model call. */
const QUIZ_DAILY = 10;

/**
 * GET /api/native/games — the lobby: who I am, who I can invite, what I am
 * invited to, and the games I am in.
 *
 * The phone polls this every few seconds while the app is open. There is no
 * push certificate, so this poll IS the invite notification: a new entry in
 * `invites` is what raises the banner.
 */
export const GET: RequestHandler = withNativeAccess('games', async (_event, identity) => {
  const me = await playerFor(identity.ownerEmail);
  const players = (await gamePlayers()).filter((p) => p.id !== me.id).map((p) => ({ id: p.id, name: p.name }));
  return {
    me: { id: me.id, name: me.name },
    players,
    invites: invitesFor(me.id),
    rooms: roomsFor(me.id),
    serverNow: Date.now(),
  };
});

/**
 * POST /api/native/games — start a game: `{ game, difficulty, invite: [playerId] }`,
 * plus `topic` (optional) and `audience` (kids | family | adults) for Quiz Night.
 */
export const POST: RequestHandler = withNativeAccess('games', async (event, identity, role) => {
  const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: 'Body must be JSON' }, { status: 400 });
  const game = body.game;
  if (!isGameId(game)) error(400, 'Unknown game.');
  if (!isDifficulty(body.difficulty)) error(400, 'Pick easy, medium or hard.');
  const ids = Array.isArray(body.invite) ? body.invite.filter((x): x is string => typeof x === 'string') : [];
  if (ids.length > MAX_PLAYERS - 1) error(400, `Up to ${MAX_PLAYERS} players.`);

  const me = await playerFor(identity.ownerEmail);
  const roster = new Map((await gamePlayers()).map((p) => [p.id, p]));
  const invite = ids.map((id) => {
    const p = roster.get(id);
    if (!p) error(400, 'One of those players cannot be invited.');
    return { id: p.id, name: p.name };
  });

  const difficulty = body.difficulty;
  // Every refusal BEFORE the cap is charged: a quiz that was never going to
  // start must not cost a member one of their ten.
  asHttp(() => canCreate(me.id));
  if (game === 'quiz-night') {
    const topic = cleanTopic(body.topic);
    const audience = isAudience(body.audience) ? body.audience : 'family';
    if (topic && !isClean(topic, audience)) error(400, 'Pick a different topic.');
  }
  if (game === 'quiz-night' && role === 'member') {
    await reserveUsage(
      await areaAccess(event, 'games'),
      'games-quiz',
      QUIZ_DAILY,
      `That is ${QUIZ_DAILY} quizzes today — the limit. Try Tap Duel or Wordle Race.`,
    );
  }
  const options = { topic: body.topic, audience: body.audience };
  const room = asHttp(() => createGame({ game, host: { id: me.id, name: me.name }, invite, difficulty, options }));
  return json({ room }, { status: 201 });
});
