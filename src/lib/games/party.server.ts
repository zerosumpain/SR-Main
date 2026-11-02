// Parties: the people at one linked TV, and the games they play there.
//
// In memory, like the rooms (a deploy ends a party; the TV opens a fresh one
// and everybody scans again). A party belongs to one TV (`./tv-devices.server`)
// and holds who has joined — family members as themselves (`playerId`), guests
// by name (`v_` ids, `./party`) — the game the TV has picked, and the room it is
// playing. Starting makes an ordinary room with `createGame`, everybody in it
// joined and the TV pressing start, so every game's rules run unchanged; when
// the room ends the party is back in its lobby with the same people.
//
// Two streams: the TV's (`tvStream`: the party, then the room's `toScreen`
// while one runs) and each player's (`memberStream`: the party, then their own
// `toWire`). Moves come in through `memberAct`, refused for anybody kicked.

import { EventEmitter } from 'node:events';
import { env } from '$env/dynamic/private';
import { GAMES, isGameId, type GameId } from './catalogue';
import { TITLES } from './invite-push.server';
import { act, createGame, endRoom, ensureRoom, hostOf, roomStage, subscribe, watch, type WireRoom } from './rooms.server';
import { newCode, normaliseCode } from './screens';
import { GameError, isDifficulty, type Difficulty } from './tap-duel';
import { PARTY_GAMES, PARTY_MAX, QUIZZES_PER_TV_DAY, SETUP_FIRST, cleanGuestName, issueSeat, newGuestId, newPartyId, partyRange, type MemberKind, type PartyGame, type PartyView } from './party';

export type { MemberKind, PartyGame, PartyView };

/** Parties at once, across every TV. */
export const MAX_PARTIES = 100;
/** A party whose TV has been gone this long, with nothing running, is closed. */
export const PARTY_IDLE_MS = 30 * 60_000;
const SWEEP_MS = 5 * 60_000;
const KEEPALIVE_MS = 15_000;

/** The lobby verbs a phone may not send at a party: the TV starts, ends and invites. */
const TV_ONLY = new Set(['start', 'again', 'join', 'decline', 'invite', 'screen', 'close']);


interface Member {
  id: string;
  name: string;
  kind: MemberKind;
  joinedAt: number;
  active: boolean;
}

interface Party {
  id: string;
  code: string;
  tvId: string;
  tvName: string;
  members: Member[];
  locked: boolean;
  game: GameId | null;
  options: Record<string, unknown>;
  roomId: string | null;
  /** Why the last start was refused, for the TV to say; cleared by the next change. */
  notice: string | null;
  createdAt: number;
  tvStreams: number;
  tvGoneAt: number | null;
  online: Map<string, number>;
  events: EventEmitter;
  stopRoom: () => void;
}

const parties = new Map<string, Party>();
const byCode = new Map<string, string>();
const byTv = new Map<string, string>();

export function partyGames(): PartyGame[] {
  return PARTY_GAMES.filter((g) => !!GAMES[g]?.toScreen).map((id) => ({ id, title: TITLES[id], ...partyRange(id) }));
}

function view(p: Party, now = Date.now()): PartyView {
  return {
    id: p.id,
    code: p.code,
    tvName: p.tvName,
    phase: p.roomId ? 'playing' : 'lobby',
    locked: p.locked,
    game: p.game,
    options: p.options,
    members: p.members.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name, kind: m.kind, online: (p.online.get(m.id) ?? 0) > 0 })),
    roomId: p.roomId,
    notice: p.notice,
    games: partyGames(),
    joinPath: `/games/join/${p.code}`,
    serverNow: now,
  };
}

function changed(p: Party): void {
  p.events.emit('change');
}

function sweep(now = Date.now()): void {
  for (const p of [...parties.values()]) {
    if (p.tvStreams === 0 && p.tvGoneAt !== null && now - p.tvGoneAt > PARTY_IDLE_MS) closeParty(p, 'idle');
  }
}

let sweeper: ReturnType<typeof setInterval> | null = null;
function startSweep(): void {
  if (sweeper) return;
  sweeper = setInterval(() => sweep(), SWEEP_MS);
  sweeper.unref?.();
}

function closeParty(p: Party, why: string): void {
  if (!parties.has(p.id)) return;
  stopGame(p, p.tvName);
  parties.delete(p.id);
  byCode.delete(p.code);
  if (byTv.get(p.tvId) === p.id) byTv.delete(p.tvId);
  p.events.emit('closed', why);
  p.events.removeAllListeners();
}

/** The TV's party: the one it has open, or a fresh one. */
export function openParty(tv: { id: string; name: string }, now = Date.now()): PartyView {
  startSweep();
  const existing = byTv.get(tv.id);
  const known = existing ? parties.get(existing) : undefined;
  if (known) {
    known.tvName = tv.name;
    return view(known, now);
  }
  sweep(now);
  if (parties.size >= MAX_PARTIES) throw new GameError(409, 'Too many parties running. Try again shortly.');
  const p: Party = {
    id: newPartyId(),
    code: newCode((c) => byCode.has(c)),
    tvId: tv.id,
    tvName: tv.name,
    members: [],
    locked: false,
    game: PARTY_GAMES[0] ?? null,
    options: {},
    roomId: null,
    notice: null,
    createdAt: now,
    tvStreams: 0,
    tvGoneAt: now,
    online: new Map(),
    events: new EventEmitter(),
    stopRoom: () => {},
  };
  p.events.setMaxListeners(64);
  parties.set(p.id, p);
  byCode.set(p.code, p.id);
  byTv.set(tv.id, p.id);
  return view(p, now);
}

function tvParty(tvId: string): Party {
  const id = byTv.get(tvId);
  const p = id ? parties.get(id) : undefined;
  if (!p) throw new GameError(404, 'This TV has no party open.');
  return p;
}

function codeParty(rawCode: unknown): Party {
  const code = normaliseCode(rawCode);
  const id = code ? byCode.get(code) : undefined;
  const p = id ? parties.get(id) : undefined;
  if (!p) throw new GameError(404, 'No TV is showing that code. Check the letters on the screen.');
  return p;
}

/** A party by the code its TV shows, as a joining phone sees it. */
export function partyByCode(code: unknown): PartyView {
  return view(codeParty(code));
}

/** The member a seat or a session names, at the party behind `code`; refused if they are not in it now. */
function member(p: Party, memberId: string): Member {
  const m = p.members.find((x) => x.id === memberId);
  if (!m) throw new GameError(403, 'Join the game on the TV first.');
  if (!m.active) throw new GameError(403, 'You were taken out of this game on the TV.');
  return m;
}

function seatFor(p: Party, memberId: string): string {
  return issueSeat(p.id, memberId, env.AUTH_SECRET ?? '');
}

function admit(p: Party, m: Omit<Member, 'joinedAt' | 'active'>, now: number): Member {
  const already = p.members.find((x) => x.id === m.id);
  if (already?.active) return already;
  if (already && !already.active) throw new GameError(403, 'You were taken out of this game on the TV.');
  if (p.locked) throw new GameError(423, 'The TV has locked this game. Ask whoever has the remote.');
  if (p.members.filter((x) => x.active).length >= PARTY_MAX) throw new GameError(409, `This game is full — ${PARTY_MAX} players at most.`);
  const joined: Member = { ...m, joinedAt: now, active: true };
  p.members.push(joined);
  p.notice = null;
  changed(p);
  return joined;
}

/** A family member joins as themselves (the app, or a signed-in browser). */
export function joinFamily(code: unknown, player: { id: string; name: string }, now = Date.now()): { party: PartyView; memberId: string; seat: string } {
  const p = codeParty(code);
  const m = admit(p, { id: player.id, name: player.name, kind: 'family' }, now);
  return { party: view(p, now), memberId: m.id, seat: seatFor(p, m.id) };
}

/** A guest joins by name from the QR, and is handed a seat for this party only. */
export function joinGuest(code: unknown, rawName: unknown, now = Date.now()): { party: PartyView; memberId: string; seat: string } {
  const p = codeParty(code);
  const taken = p.members.filter((m) => m.active).map((m) => m.name);
  const name = cleanGuestName(rawName, taken);
  if (!name) throw new GameError(400, 'Pick a different name — letters and numbers, up to sixteen.');
  const m = admit(p, { id: newGuestId(), name, kind: 'guest' }, now);
  return { party: view(p, now), memberId: m.id, seat: seatFor(p, m.id) };
}

/** Whether `memberId` was taken out of this party on the TV (a kicked guest cannot come back under a new name from the same browser). */
export function wasKicked(code: unknown, memberId: string): boolean {
  return codeParty(code).members.some((m) => m.id === memberId && !m.active);
}

/** The party's id for a code — the route reads the seat cookie named after it. */
export function partyIdFor(code: unknown): string {
  return codeParty(code).id;
}

/** Somebody back with a seat (a reload): still at this party? */
export function seated(code: unknown, memberId: string): { party: PartyView; member: { id: string; name: string; kind: MemberKind } } {
  const p = codeParty(code);
  const m = member(p, memberId);
  return { party: view(p), member: { id: m.id, name: m.name, kind: m.kind } };
}

// ── The TV's verbs ───────────────────────────────────────────────────────────

function difficultyOf(options: Record<string, unknown>): Difficulty {
  return isDifficulty(options.difficulty) ? options.difficulty : 'medium';
}

/** Only plain values: options travel to `createGame`, which bounds each game's own. */
function cleanOptions(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 20)) {
    if (!/^[a-zA-Z]{1,24}$/u.test(k)) continue;
    if (typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 200)) out[k] = v;
  }
  return out;
}

function stopGame(p: Party, byName: string): void {
  const id = p.roomId;
  p.stopRoom();
  p.stopRoom = () => {};
  p.roomId = null;
  if (id) endRoom(id, byName);
}

/** When each TV last started AI-written quizzes, for the daily cap. */
const quizStarts = new Map<string, number[]>();
const DAY_MS = 24 * 3_600_000;

function chargeQuiz(tvId: string, now = Date.now()): void {
  const recent = (quizStarts.get(tvId) ?? []).filter((t) => now - t < DAY_MS);
  if (recent.length >= QUIZZES_PER_TV_DAY) {
    throw new GameError(429, `That is ${QUIZZES_PER_TV_DAY} quizzes on this TV today — the limit. Try Kelloggle or Codenames.`);
  }
  recent.push(now);
  quizStarts.set(tvId, recent);
}

function startGame(p: Party): void {
  if (p.roomId) throw new GameError(409, 'A game is already running. End it first.');
  const game = p.game;
  if (!game || !PARTY_GAMES.includes(game)) throw new GameError(400, 'Pick a game first.');
  const players = p.members.filter((m) => m.active);
  const { min, max } = partyRange(game);
  if (players.length < min || players.length > max) {
    const range = min === max ? `${min}` : `${min}–${max}`;
    throw new GameError(409, `${TITLES[game]} needs ${range} players — ${players.length} joined.`);
  }
  const [host, ...rest] = players;
  // Every refusal createGame would make comes before the quiz is charged.
  // A pack is John's own questions: no model call, nothing to charge.
  if (game === 'quiz-night' && !p.options.pack) chargeQuiz(p.tvId);
  const room = createGame({
    game,
    host: { id: host.id, name: host.name },
    invite: rest.map((m) => ({ id: m.id, name: m.name })),
    difficulty: difficultyOf(p.options),
    // `kelly`: the party's flavour (Boggle's Kelly word); a game that knows nothing of it ignores it.
    options: { ...p.options, kelly: true },
  });
  try {
    for (const m of rest) act(room.id, m.id, 'join');
    // A game with set-up waits in its own lobby for the TV's Go.
    if (!SETUP_FIRST.has(game)) act(room.id, host.id, 'start');
  } catch (err) {
    endRoom(room.id, p.tvName);
    throw err;
  }
  p.roomId = room.id;
  p.stopRoom = watch(
    room.id,
    () => {},
    () => {
      if (p.roomId !== room.id) return;
      p.roomId = null;
      p.stopRoom = () => {};
      changed(p);
    },
  );
}

/**
 * One verb from the TV: `pick {game, options}`, `start`, `again` (a fresh
 * room for the same game with whoever is here now), `end` (stop the game,
 * back to the lobby), `kick {memberId}`, `lock`, `unlock`, `close`.
 */
export function tvAct(tvId: string, action: unknown, body: Record<string, unknown> = {}, now = Date.now()): PartyView {
  const p = tvParty(tvId);
  p.notice = null;
  switch (action) {
    case 'pick': {
      if (p.roomId) throw new GameError(409, 'End the game on the TV first.');
      if (!isGameId(body.game) || !PARTY_GAMES.includes(body.game)) throw new GameError(400, 'That game is not on the TV yet.');
      p.game = body.game;
      p.options = cleanOptions(body.options);
      break;
    }
    case 'start':
      try {
        startGame(p);
      } catch (err) {
        if (err instanceof GameError) p.notice = err.message;
        changed(p);
        throw err;
      }
      break;
    case 'again':
      stopGame(p, p.tvName);
      try {
        startGame(p);
      } catch (err) {
        if (err instanceof GameError) p.notice = err.message;
        changed(p);
        throw err;
      }
      break;
    case 'go': {
      // Play starts in a room waiting in its lobby (teams picked, questions written).
      const host = p.roomId ? hostOf(p.roomId) : null;
      if (!p.roomId || !host) throw new GameError(409, 'No game is waiting to start.');
      try {
        act(p.roomId, host, 'start');
      } catch (err) {
        if (err instanceof GameError) p.notice = err.message;
        changed(p);
        throw err;
      }
      break;
    }
    case 'end':
      stopGame(p, p.tvName);
      break;
    case 'kick': {
      const m = p.members.find((x) => x.id === body.memberId && x.active);
      if (!m) throw new GameError(404, 'Nobody by that name is here.');
      m.active = false;
      if (p.roomId) {
        try {
          act(p.roomId, m.id, 'leave');
        } catch {
          /* the room may already be done with them */
        }
      }
      p.events.emit('kicked', m.id);
      break;
    }
    case 'lock':
      p.locked = true;
      break;
    case 'unlock':
      p.locked = false;
      break;
    case 'close': {
      const tv = { id: p.tvId, name: p.tvName };
      closeParty(p, 'closed');
      return openParty(tv, now);
    }
    default:
      throw new GameError(400, 'Unknown action.');
  }
  changed(p);
  return view(p, now);
}

/** A move from a player at the party, into the room it is playing. */
export function memberAct(code: unknown, memberId: string, action: unknown, body: Record<string, unknown> = {}): WireRoom {
  const p = codeParty(code);
  member(p, memberId);
  if (typeof action !== 'string' || TV_ONLY.has(action)) throw new GameError(400, 'Unknown action.');
  if (!p.roomId) throw new GameError(409, 'No game is running on the TV.');
  return act(p.roomId, memberId, action, body);
}

// ── Streams ──────────────────────────────────────────────────────────────────

/** An SSE response whose body `setup` writes; `setup` returns its own cleanup. */
function sse(setup: (send: (frame: unknown) => void, end: () => void) => () => void): Response {
  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const pending: Uint8Array[] = [];
  let closed = false;
  let teardown = () => {};

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
      cleanup();
    }
  };
  const keepalive = setInterval(() => write(': keepalive\n\n'), KEEPALIVE_MS);
  keepalive.unref?.();
  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(keepalive);
    teardown();
  }
  const end = () => {
    cleanup();
    try {
      controllerRef?.close();
    } catch {
      /* already closed */
    }
  };
  teardown = setup((frame) => write(`data: ${JSON.stringify(frame)}\n\n`), end);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      for (const chunk of pending.splice(0)) controller.enqueue(chunk);
      if (closed) controller.close();
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/**
 * Follow whichever room the party is playing, re-pointing as it changes.
 * `follow` subscribes to one room and returns its unsubscribe.
 */
function roomFollower(p: Party, follow: (roomId: string) => () => void) {
  let current: string | null = null;
  let stop = () => {};
  return {
    sync() {
      if (p.roomId === current) return;
      stop();
      stop = () => {};
      current = p.roomId;
      if (current) {
        try {
          stop = follow(current);
        } catch (err) {
          if (!(err instanceof GameError)) throw err;
          current = null;
        }
      }
    },
    stop() {
      stop();
      stop = () => {};
      current = null;
    },
  };
}

/**
 * The TV's stream: `{type:'party'}` now and on every change, `{type:'room'}`
 * (the game's `toScreen`) while a room runs, `{type:'closed'}` and the end
 * when the party closes (the page reopens a fresh one).
 */
export async function tvStream(tv: { id: string; name: string }): Promise<Response> {
  openParty(tv);
  const p = tvParty(tv.id);
  if (p.roomId) await ensureRoom(p.roomId).catch(() => {});
  return sse((send, end) => {
    p.tvStreams += 1;
    p.tvGoneAt = null;
    const rooms = roomFollower(p, (roomId) => watch(roomId, (room) => send({ type: 'room', room }), () => {}));
    const onChange = () => {
      send({ type: 'party', party: view(p) });
      rooms.sync();
    };
    const onClosed = () => {
      send({ type: 'closed' });
      end();
    };
    p.events.on('change', onChange);
    p.events.once('closed', onClosed);
    onChange();
    return () => {
      p.events.off('change', onChange);
      p.events.off('closed', onClosed);
      rooms.stop();
      p.tvStreams = Math.max(0, p.tvStreams - 1);
      if (p.tvStreams === 0) p.tvGoneAt = Date.now();
    };
  });
}

/**
 * A player's stream: `{type:'party'}` now and on every change, `{type:'room'}`
 * (their own `toWire`) while a room they are in runs, `{type:'kicked'}` or
 * `{type:'closed'}` and the end.
 */
export function memberStream(code: unknown, memberId: string): Response {
  const p = codeParty(code);
  member(p, memberId);
  return sse((send, end) => {
    p.online.set(memberId, (p.online.get(memberId) ?? 0) + 1);
    const rooms = roomFollower(p, (roomId) => {
      const stage = roomStage(roomId);
      if (!stage) return () => {};
      return subscribe(roomId, memberId, (room) => send({ type: 'room', room }), () => {});
    });
    const onChange = () => {
      send({ type: 'party', party: view(p) });
      rooms.sync();
    };
    const onKicked = (id: string) => {
      if (id !== memberId) return;
      send({ type: 'kicked' });
      end();
    };
    const onClosed = () => {
      send({ type: 'closed' });
      end();
    };
    p.events.on('change', onChange);
    p.events.on('kicked', onKicked);
    p.events.once('closed', onClosed);
    onChange();
    // Somebody came online: the TV's list lights them up.
    changed(p);
    return () => {
      p.events.off('change', onChange);
      p.events.off('kicked', onKicked);
      p.events.off('closed', onClosed);
      rooms.stop();
      const n = (p.online.get(memberId) ?? 1) - 1;
      if (n > 0) p.online.set(memberId, n);
      else p.online.delete(memberId);
      if (parties.has(p.id)) changed(p);
    };
  });
}

/** Tests only. */
export function _resetParties(): void {
  quizStarts.clear();
  for (const p of [...parties.values()]) closeParty(p, 'reset');
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
}

/** Tests only. */
export function _sweepParties(now: number): void {
  sweep(now);
}

