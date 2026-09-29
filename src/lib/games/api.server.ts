// The games API's bodies, shared by the two doors into the same rooms:
// the phone (`/api/native/games`, `withNativeAccess('games', …)`) and the
// browser (`/api/games`, `withGamesSession`). Each door authenticates its own
// way and hands over an email; everything after that — who the player is, what
// the lobby holds, which moves are legal — is decided here once, so a person is
// the same `playerId(email)` at the same table whichever door they came in by.
//
// Refusals are thrown as SvelteKit HTTP errors (`error()` / `asHttp`); both
// wrappers turn them into `{ error }` with their status, because the sentences
// are written for the person playing.

import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { gamePlayers, playerFor } from './players.server';
import { act, asHttp, canCreate, createGame, inviteTo, invitesFor, roomFor, roomsFor, subscribe } from './rooms.server';
import { pushInvites } from './invite-push.server';
import { isDifficulty, MAX_PLAYERS } from './tap-duel';
import { isGameId, type GameId } from './catalogue';
import { cleanTopic, isAudience, isClean } from './quiz-night';
import { reserveUsage } from '$lib/jkai/chat-access.server';
import { areaAccess } from '$lib/server/area-scope';

/** Quiz Nights a member may start per rolling 24 h — each is one model call. */
export const QUIZ_DAILY = 10;

export type GameRole = 'owner' | 'member';

/** Who is calling, however they authenticated. */
export interface GameCaller {
  email: string;
  role: GameRole;
}

/**
 * The lobby: who I am, who I can invite, what I am invited to, and the games
 * I am in.
 */
export async function lobbyFor(caller: GameCaller) {
  const me = await playerFor(caller.email);
  const players = (await gamePlayers()).filter((p) => p.id !== me.id).map((p) => ({ id: p.id, name: p.name }));
  return {
    me: { id: me.id, name: me.name },
    players,
    invites: invitesFor(me.id),
    rooms: roomsFor(me.id),
    serverNow: Date.now(),
  };
}

/** Resolve invitee ids against the roster; anyone not on it is refused. */
async function resolveInvitees(ids: string[]) {
  const roster = new Map((await gamePlayers()).map((p) => [p.id, p]));
  return ids.map((id) => {
    const p = roster.get(id);
    if (!p) error(400, 'One of those players cannot be invited.');
    return { id: p.id, name: p.name };
  });
}

const stringIds = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * Start a game: `{ game, difficulty, invite: [playerId] }` plus that game's
 * options (Quiz Night `topic`/`audience`, Boggle `size`/`seconds`/`scoring`,
 * Categories `categoryCount`/`seconds`, Liar's Dice `dice`, Draw & Guess
 * `turnsEach`/`seconds`). `only` narrows which games this door may start — the
 * web plays Liar's Dice alone for now.
 */
export async function startGame(
  event: Pick<RequestEvent, 'locals'>,
  caller: GameCaller,
  body: Record<string, unknown>,
  only?: readonly GameId[],
) {
  const game = body.game;
  if (!isGameId(game)) error(400, 'Unknown game.');
  if (only && !only.includes(game)) error(400, 'Start that game from the app.');
  if (!isDifficulty(body.difficulty)) error(400, 'Pick easy, medium or hard.');
  const ids = stringIds(body.invite);
  if (ids.length > MAX_PLAYERS - 1) error(400, `Up to ${MAX_PLAYERS} players.`);

  const me = await playerFor(caller.email);
  const invite = await resolveInvitees(ids);
  const difficulty = body.difficulty;
  // Every refusal BEFORE the cap is charged: a quiz that was never going to
  // start must not cost a member one of their ten.
  asHttp(() => canCreate(me.id));
  if (game === 'quiz-night') {
    const topic = cleanTopic(body.topic);
    const audience = isAudience(body.audience) ? body.audience : 'family';
    if (topic && !isClean(topic, audience)) error(400, 'Pick a different topic.');
  }
  if (game === 'quiz-night' && caller.role === 'member') {
    await reserveUsage(
      await areaAccess(event, 'games'),
      'games-quiz',
      QUIZ_DAILY,
      `That is ${QUIZ_DAILY} quizzes today — the limit. Try Tap Duel or Wordle Race.`,
    );
  }
  const options = {
    topic: body.topic,
    audience: body.audience,
    size: body.size,
    seconds: body.seconds,
    scoring: body.scoring,
    categoryCount: body.categoryCount,
    dice: body.dice,
    turnsEach: body.turnsEach,
  };
  const room = asHttp(() => createGame({ game, host: { id: me.id, name: me.name }, invite, difficulty, options }));
  // Not awaited: the host's screen should not wait on Apple. An invite whose
  // push fails is still collected by the invitee's poll (app or web lobby).
  void pushInvites(room.id);
  return room;
}

/** One room as this player sees it. */
export async function roomView(caller: GameCaller, id: string) {
  const me = await playerFor(caller.email);
  return asHttp(() => roomFor(id, me.id));
}

/**
 * `{ action, …the move's fields }`: a lobby verb (join | decline | leave |
 * start | again), `invite` {invite: [playerId]} from the host while the lobby
 * is open, or the game's own move. Answers with the room after it; a `since`
 * in the body (Draw & Guess's drawing revision) is read by `act` and asks for
 * the drawing as the changes after it.
 */
export async function roomAct(caller: GameCaller, id: string, body: Record<string, unknown>) {
  const action = body.action;
  if (typeof action !== 'string') error(400, 'Unknown action.');
  const me = await playerFor(caller.email);
  if (action === 'invite') {
    // Resolved against the same roster a new game's invites are, so nobody
    // without games access — or without anywhere to open it — can be named.
    const ids = stringIds(body.invite);
    if (!ids.length) error(400, 'Pick somebody to invite.');
    const people = await resolveInvitees(ids);
    const room = asHttp(() => inviteTo(id, me.id, people));
    void pushInvites(id);
    return room;
  }
  const room = asHttp(() => act(id, me.id, action, body));
  // "Play again" re-invites everybody; their phones are rung afresh.
  if (action === 'again') void pushInvites(id);
  return room;
}

const KEEPALIVE_MS = 15_000;

/**
 * The room as SSE, one `{"type":"room","room":…}` frame now and on every
 * change; a `{"type":"gone"}` frame and the end of the stream when the room is
 * dropped.
 *
 * The shape of `api/research/[id]/stream`: replay on connect, a keepalive
 * comment so cloudflared does not reap a quiet lobby, cleanup on cancel.
 */
export async function roomStream(caller: GameCaller, id: string): Promise<Response> {
  const me = await playerFor(caller.email);
  const encoder = new TextEncoder();
  let cleanup = () => {};

  // Subscribing throws for a room that is gone or not theirs; do it before the
  // stream exists so that comes back as a status, not a stream that dies.
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const pending: Uint8Array[] = [];
  let closed = false;
  const write = (text: string) => {
    if (closed) return;
    const chunk = encoder.encode(text);
    if (!controllerRef) {
      pending.push(chunk);
      return;
    }
    try {
      controllerRef.enqueue(chunk);
    } catch {
      closed = true;
      cleanup();
    }
  };

  const unsubscribe = asHttp(() =>
    subscribe(
      id,
      me.id,
      (room) => write(`data: ${JSON.stringify({ type: 'room', room })}\n\n`),
      () => {
        write(`data: ${JSON.stringify({ type: 'gone' })}\n\n`);
        closed = true;
        cleanup();
        try {
          controllerRef?.close();
        } catch {
          /* already closed */
        }
      },
    ),
  );

  const keepalive = setInterval(() => write(': keepalive\n\n'), KEEPALIVE_MS);
  cleanup = () => {
    closed = true;
    clearInterval(keepalive);
    unsubscribe();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      for (const chunk of pending.splice(0)) controller.enqueue(chunk);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Caddy/cloudflared will happily buffer an event stream into uselessness.
      'X-Accel-Buffering': 'no',
    },
  });
}

/** Read a JSON object body, or null. */
export async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}
