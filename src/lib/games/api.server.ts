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
import { gamePlayers, playerFor, playerId } from './players.server';
import { leaderboard } from './results.server';
import { isWindow } from './results';
import {
  act,
  asHttp,
  canCreate,
  canCreateDurable,
  createGame,
  ensureRoom,
  flush,
  gameOf,
  hydrateFor,
  inviteTo,
  invitesFor,
  noteParent,
  roomFor,
  roomStage,
  roomsFor,
  subscribe,
} from './rooms.server';
import { pushInvites } from './invite-push.server';
import { GameError, isDifficulty, MAX_PLAYERS } from './tap-duel';
import { GAMES, isGameId, type Pace } from './catalogue';
import { cleanTopic, isAudience, isClean } from './quiz-night';
import { subjectFor } from './gcse';
import { reserveUsage } from '$lib/jkai/chat-access.server';
import { areaAccess } from '$lib/server/area-scope';
import { familyRole } from '$lib/server/family-access';

/** Quiz Nights a member may start per rolling 24 h — each is two model calls (write, then check). */
export const QUIZ_DAILY = 10;

export type GameRole = 'owner' | 'member';

/**
 * Games only a parent (or the owner) may host, by the title their refusal
 * names, with the set-up actions each checks against the caller's role.
 * Manhunt sends children out into the real world, so the person who draws
 * the circle and starts the clock is a grown-up in the family roles
 * (`family:admin`). A Hometowns county runs for months on the family's
 * phones, so starting it, pausing it and changing its settings (the rivalry,
 * the Regional Day's hour, a child's seat) are a parent's too (spec
 * 2026-10-24 Hometowns §10.12 F6). Keyed by id rather than `GameId` so an
 * entry can wait here for its game to be registered.
 */
const PARENT_HOSTED: ReadonlyMap<string, { title: string; actions: ReadonlySet<string> }> = new Map([
  ['manhunt', { title: 'Manhunt', actions: new Set(['start', 'again', 'area', 'runner']) }],
  ['hometowns', { title: 'Hometowns', actions: new Set(['start', 'again', 'pause', 'settings']) }],
]);

/** Every parent-hosted game's set-up actions, so an ordinary move never looks its room up. */
const SET_UP_ACTIONS: ReadonlySet<string> = new Set([...PARENT_HOSTED.values()].flatMap((g) => [...g.actions]));

/**
 * The room's game when this action needs the caller's family role checked
 * (a set-up action, or a `join` that may hand a parent the host seat) and
 * the game is parent-hosted; null otherwise.
 */
function setUpGame(id: string, playerId: string, action: string): string | null {
  if (!SET_UP_ACTIONS.has(action) && action !== 'join') return null;
  const game = asHttp(() => gameOf(id, playerId));
  return PARENT_HOSTED.has(game) ? game : null;
}

async function isParent(caller: GameCaller): Promise<boolean> {
  const role = caller.role === 'owner' ? { parent: true } : await familyRole(caller.email);
  return role?.parent === true;
}

async function assertParent(caller: GameCaller, game: string): Promise<void> {
  if (!(await isParent(caller))) error(403, `Only a parent can host ${PARENT_HOSTED.get(game)?.title ?? 'this game'}.`);
}

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
  // Durable rooms this player is in come back into memory first (after a
  // restart, or an async game evicted while idle), so they list like any other.
  await hydrateFor(me.id);
  return {
    me: { id: me.id, name: me.name },
    players,
    invites: invitesFor(me.id),
    rooms: roomsFor(me.id),
    // The games a host may play over days: the app offers a pace picker for these.
    paces: gamePaces(),
    serverNow: Date.now(),
  };
}

/** Each game whose `paces` offer more than 'live', with them. */
function gamePaces(): Record<string, Pace[]> {
  const out: Record<string, Pace[]> = {};
  for (const [id, rules] of Object.entries(GAMES)) {
    const paces = rules?.paces ?? [];
    if (paces.some((p) => p !== 'live')) out[id] = [...paces];
  }
  return out;
}

/** A stored durable room into memory before a synchronous room call; a database that is down is a 503. */
async function loaded(id: string): Promise<void> {
  try {
    await ensureRoom(id);
  } catch (err) {
    if (err instanceof GameError) error(err.status, err.message);
    throw err;
  }
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
 * options (Quiz Night `topic`/`audience`, or `mode: 'gcse'` with `subject`/`board`, Boggle `size`/`seconds`/`scoring`,
 * Categories `categoryCount`/`seconds`, Liar's Dice `dice`, Draw & Guess
 * `turnsEach`/`seconds`, Odd Artist Out `rounds`, Manhunt `lat`/`lng`/`radius`/`minutes`;
 * for a durable game `pace` ('live' | 'async') with `deadlineHours` (12 | 24 | 48),
 * Homestead's `island`, and Hometowns' `county`: `{ name, rivalry, regionalHour,
 * mishaps, devTickMs }`).
 */
export async function startGame(
  event: Pick<RequestEvent, 'locals'>,
  caller: GameCaller,
  body: Record<string, unknown>,
) {
  const game = body.game;
  if (!isGameId(game)) error(400, 'Unknown game.');
  if (!isDifficulty(body.difficulty)) error(400, 'Pick easy, medium or hard.');
  const ids = stringIds(body.invite);
  const cap = GAMES[game].maxPlayers ?? MAX_PLAYERS;
  if (ids.length > cap - 1) error(400, `Up to ${cap} players.`);
  if (PARENT_HOSTED.has(game)) await assertParent(caller, game);

  const me = await playerFor(caller.email);
  const invite = await resolveInvitees(ids);
  const difficulty = body.difficulty;
  // Every refusal BEFORE the cap is charged: a quiz that was never going to
  // start must not cost a member one of their ten.
  asHttp(() => canCreate(me.id, game));
  if (GAMES[game].durable) {
    try {
      await canCreateDurable(me.id);
    } catch (err) {
      if (err instanceof GameError) error(err.status, err.message);
      throw err;
    }
  }
  if (game === 'quiz-night') {
    const topic = cleanTopic(body.topic);
    const subject = body.mode === 'gcse' ? subjectFor(body.subject) : null;
    if (body.mode === 'gcse' && !subject) error(400, 'Pick a GCSE subject.');
    const audience = subject ? 'family' : isAudience(body.audience) ? body.audience : 'family';
    if (topic && !isClean(topic, audience, subject?.allows)) error(400, 'Pick a different topic.');
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
    mode: body.mode,
    subject: body.subject,
    board: body.board,
    size: body.size,
    seconds: body.seconds,
    scoring: body.scoring,
    categoryCount: body.categoryCount,
    dice: body.dice,
    turnsEach: body.turnsEach,
    course: body.course,
    rounds: body.rounds,
    // Manhunt: the circle's centre (the host's phone), radius in metres, minutes.
    lat: body.lat,
    lng: body.lng,
    radius: body.radius,
    minutes: body.minutes,
    pace: body.pace,
    deadlineHours: body.deadlineHours,
    island: body.island,
    // Hometowns: the county's name, rivalry, Regional Day hour, mishaps and
    // (local stack only, behind HOMETOWNS_DEV_CLOCK) its dev tick; the game
    // reads and bounds each field itself.
    county: body.county,
  };
  const room = asHttp(() => createGame({ game, host: { id: me.id, name: me.name }, invite, difficulty, options }));
  // A durable room is answered once it is saved (or after FLUSH_MS, the write retrying on).
  await flush(room.id);
  // Not awaited: the host's screen should not wait on Apple. An invite whose
  // push fails is still collected by the invitee's poll (app or web lobby).
  void pushInvites(room.id);
  return room;
}

/** One room as this player sees it. */
export async function roomView(caller: GameCaller, id: string) {
  const me = await playerFor(caller.email);
  await loaded(id);
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
  await loaded(id);
  if (action === 'invite') {
    // A game only a parent may host takes a late invite (into a room already
    // under way, `joinRunning`) only from a parent: the host role can have
    // passed to a child since the room was made. The lobby is as before.
    const stage = roomStage(id);
    if (stage && stage.phase !== 'lobby' && PARENT_HOSTED.has(stage.game)) await assertParent(caller);
    // Resolved against the same roster a new game's invites are, so nobody
    // without games access — or without anywhere to open it — can be named.
    const ids = stringIds(body.invite);
    if (!ids.length) error(400, 'Pick somebody to invite.');
    const people = await resolveInvitees(ids);
    const room = asHttp(() => inviteTo(id, me.id, people));
    await flush(id);
    void pushInvites(id);
    return room;
  }
  // Setting up a game whose host must be a parent is checked against the
  // caller's family role here, not only when the room was made: the host
  // role can pass to somebody else when the first host leaves mid-game.
  const game = setUpGame(id, me.id, action);
  if (game !== null && PARENT_HOSTED.get(game)!.actions.has(action)) await assertParent(caller, game);
  let room = asHttp(() => act(id, me.id, action, body));
  // A parent who joins may inherit the host seat if the host leaves, so the
  // room never ends up hosted by a child who cannot set up the next game.
  // A game that stores what a parent may do (Hometowns' adult seat) answers
  // the join with the view after it, and has it written before the answer.
  if (game !== null && action === 'join' && (await isParent(caller))) room = asHttp(() => noteParent(id, me.id)) ?? room;
  await flush(id);
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
  await loaded(id);
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

/**
 * The family's games boards for `?window=day|week|all` (default `week`):
 * overall wins, then per game each person's best, wins and games. `me` is
 * the caller's player id. Names and hashed ids only — never an email.
 */
export async function leaderboardFor(caller: GameCaller, window: string | null) {
  const asked = window ?? 'week';
  if (!isWindow(asked)) error(400, 'Pick day, week or all.');
  return { me: { id: playerId(caller.email) }, ...(await leaderboard(asked)) };
}
