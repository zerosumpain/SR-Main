// Tap Duel — the rules, as pure functions over a room.
//
// Every function takes `now` (epoch ms) and, where it deals, a `rng`, so the
// whole game can be played in a test without a clock. The live registry
// (`rooms.server.ts`) owns timers and fan-out; nothing here knows about either.
//
// Fairness rests on two choices. The server fixes `goAt` and sends it AHEAD, so
// every phone turns green at the same instant whatever its latency; and the
// phone measures the reaction itself, from green shown to tap, on its own
// monotonic clock. Network time never enters a score.

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export type Phase = 'lobby' | 'countdown' | 'armed' | 'result' | 'finished' | 'closed';
export type PlayerStatus = 'invited' | 'joined' | 'declined' | 'left';

export const ROUNDS = 5;
export const MAX_PLAYERS = 5;
export const LOBBY_MS = 3 * 60_000;
export const COUNTDOWN_MS = 3_000;
export const RESULT_MS = 2_500;
export const FINISHED_MS = 10 * 60_000;
/** After the window closes, how long a tap already in flight may still land. */
export const GRACE_MS = 1_000;
/** Faster than a person can see green: a guess, scored as a false start. */
export const ANTICIPATION_MS = 100;

interface Tuning {
  waitMs: [number, number];
  decoys: [number, number];
  windowMs: number;
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { waitMs: [2_000, 4_000], decoys: [0, 0], windowMs: 2_000 },
  medium: { waitMs: [1_500, 5_000], decoys: [0, 1], windowMs: 1_200 },
  hard: { waitMs: [1_000, 6_000], decoys: [1, 2], windowMs: 800 },
};

const DECOY_MS = 350;
/** Nothing flashes in the first moment of a round or just before green. */
const DECOY_LEAD_MS = 600;
const DECOY_TAIL_MS = 700;
const DECOY_GAP_MS = 500;

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  score: number;
  reactions: number[];
  falseStarts: number;
}

export interface TapResponse {
  playerId: string;
  reactionMs: number | null;
  early: boolean;
}

export interface Round {
  number: number;
  goAt: number;
  windowMs: number;
  closesAt: number;
  decoys: { at: number; ms: number }[];
  responses: TapResponse[];
  winnerId: string | null;
}

export interface Room {
  id: string;
  game: 'tap-duel';
  difficulty: Difficulty;
  hostId: string;
  phase: Phase;
  players: Player[];
  rounds: number;
  round: Round | null;
  /** Lobby expiry, countdown end, result end, finished expiry. */
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export class GameError extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 400,
    message: string,
  ) {
    super(message);
  }
}

export type Rng = () => number;

export function isDifficulty(value: unknown): value is Difficulty {
  return typeof value === 'string' && (DIFFICULTIES as readonly string[]).includes(value);
}

function between(rng: Rng, [lo, hi]: [number, number]): number {
  return lo + rng() * (hi - lo);
}

function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, score: 0, reactions: [], falseStarts: 0 };
}

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === 'joined');
}

function find(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new GameError(403, 'You are not in this game.');
  return p;
}

export function createRoom(input: {
  id: string;
  host: { id: string; name: string };
  invite: { id: string; name: string }[];
  difficulty: Difficulty;
  now: number;
}): Room {
  const invited = input.invite.filter((p, i, all) => p.id !== input.host.id && all.findIndex((q) => q.id === p.id) === i);
  if (invited.length > MAX_PLAYERS - 1) {
    throw new GameError(400, `Up to ${MAX_PLAYERS} players.`);
  }
  return {
    id: input.id,
    game: 'tap-duel',
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: 'lobby',
    players: [player(input.host.id, input.host.name, 'joined'), ...invited.map((p) => player(p.id, p.name, 'invited'))],
    rounds: ROUNDS,
    round: null,
    phaseEndsAt: input.now + LOBBY_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function join(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status === 'joined') return;
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  p.status = 'joined';
  room.updatedAt = now;
}

export function decline(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'invited') return;
  p.status = 'declined';
  room.updatedAt = now;
}

/**
 * Leaving the lobby as host cancels the game — the invite named them. Leaving
 * later hands the host role to the next player, so "Play again" still has
 * someone to press it, and the last one out closes the room.
 */
export function leave(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'joined') return;
  p.status = 'left';
  room.updatedAt = now;
  if (room.phase === 'lobby' && playerId === room.hostId) {
    close(room, now);
    return;
  }
  const rest = joined(room);
  if (rest.length === 0) {
    close(room, now);
    return;
  }
  if (playerId === room.hostId) room.hostId = rest[0].id;
  if (room.phase === 'armed') settleIfAnswered(room, now);
}

function close(room: Room, now: number): void {
  room.phase = 'closed';
  room.phaseEndsAt = null;
  room.updatedAt = now;
}

export function start(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start.');
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  for (const p of room.players) if (p.status === 'invited') p.status = 'declined';
  room.phase = 'countdown';
  room.phaseEndsAt = now + COUNTDOWN_MS;
  room.updatedAt = now;
}

/** The host plays again with whoever is still here; everyone else is asked again. */
export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start another.');
  if (room.phase !== 'finished') throw new GameError(409, 'This game is still going.');
  for (const p of room.players) {
    p.status = p.status === 'joined' ? 'joined' : 'invited';
    p.score = 0;
    p.reactions = [];
    p.falseStarts = 0;
  }
  room.phase = 'lobby';
  room.round = null;
  room.phaseEndsAt = now + LOBBY_MS;
  room.createdAt = now;
  room.updatedAt = now;
}

export function dealRound(number: number, difficulty: Difficulty, now: number, rng: Rng): Round {
  const t = TUNING[difficulty];
  const goAt = Math.round(now + between(rng, t.waitMs));
  const want = Math.round(between(rng, t.decoys));
  const lo = now + DECOY_LEAD_MS;
  const hi = goAt - DECOY_TAIL_MS - DECOY_MS;
  const decoys: { at: number; ms: number }[] = [];
  for (let i = 0; i < want * 4 && decoys.length < want && hi > lo; i++) {
    const at = Math.round(lo + rng() * (hi - lo));
    if (decoys.every((d) => Math.abs(d.at - at) >= DECOY_MS + DECOY_GAP_MS)) decoys.push({ at, ms: DECOY_MS });
  }
  decoys.sort((a, b) => a.at - b.at);
  return {
    number,
    goAt,
    windowMs: t.windowMs,
    closesAt: goAt + t.windowMs + GRACE_MS,
    decoys,
    responses: [],
    winnerId: null,
  };
}

/**
 * One tap per player per round. The phone says whether it was early and, if
 * not, how long it took; the server only refuses the impossible. A reaction
 * under 100 ms is a guess, not a reflex, and one past the window is a miss.
 */
export function tap(
  room: Room,
  playerId: string,
  input: { round: number; reactionMs: number | null; early: boolean },
  now: number,
): void {
  const p = find(room, playerId);
  if (p.status !== 'joined') throw new GameError(403, 'You are not playing this game.');
  const r = room.round;
  if (room.phase !== 'armed' || !r || r.number !== input.round) {
    throw new GameError(409, 'That round is over.');
  }
  if (r.responses.some((x) => x.playerId === playerId)) return;

  let early = input.early;
  let reactionMs = early ? null : input.reactionMs;
  if (!early && (reactionMs === null || !Number.isFinite(reactionMs))) {
    throw new GameError(400, 'A tap needs a reaction time.');
  }
  if (!early && reactionMs !== null) {
    reactionMs = Math.round(reactionMs);
    if (reactionMs < ANTICIPATION_MS) {
      early = true;
      reactionMs = null;
    } else if (reactionMs > r.windowMs) {
      reactionMs = null;
    }
  }
  r.responses.push({ playerId, reactionMs, early });
  room.updatedAt = now;
  settleIfAnswered(room, now);
}

function settleIfAnswered(room: Room, now: number): void {
  const r = room.round;
  if (!r) return;
  const answered = new Set(r.responses.map((x) => x.playerId));
  if (joined(room).every((p) => answered.has(p.id))) settle(room, now);
}

function settle(room: Room, now: number): void {
  const r = room.round!;
  let best: TapResponse | null = null;
  for (const x of r.responses) {
    if (x.early || x.reactionMs === null) continue;
    if (!best || x.reactionMs < best.reactionMs!) best = x;
  }
  r.winnerId = best?.playerId ?? null;
  for (const x of r.responses) {
    const p = room.players.find((q) => q.id === x.playerId);
    if (!p) continue;
    if (x.early) p.falseStarts++;
    else if (x.reactionMs !== null) p.reactions.push(x.reactionMs);
    if (x.playerId === r.winnerId) p.score++;
  }
  room.phase = 'result';
  room.phaseEndsAt = now + RESULT_MS;
  room.updatedAt = now;
}

/**
 * Move a room along the clock: whatever deadline has passed, act on it. Loops,
 * so a registry that slept through two deadlines lands where it should.
 * Returns whether anything changed.
 */
export function advance(room: Room, now: number, rng: Rng): boolean {
  // A clock that is not a number would make every deadline "due".
  if (!Number.isFinite(now)) return false;
  let changed = false;
  for (let guard = 0; guard < 20; guard++) {
    const due = deadline(room);
    if (due === null || due > now) break;
    changed = true;
    switch (room.phase) {
      case 'lobby':
      case 'finished':
        close(room, due);
        break;
      case 'countdown':
        room.phase = 'armed';
        room.round = dealRound(1, room.difficulty, due, rng);
        room.phaseEndsAt = null;
        room.updatedAt = due;
        break;
      case 'armed':
        settle(room, due);
        break;
      case 'result': {
        const next = (room.round?.number ?? 0) + 1;
        if (next > room.rounds) {
          room.phase = 'finished';
          room.phaseEndsAt = due + FINISHED_MS;
        } else {
          room.phase = 'armed';
          room.round = dealRound(next, room.difficulty, due, rng);
          room.phaseEndsAt = null;
        }
        room.updatedAt = due;
        break;
      }
    }
  }
  return changed;
}

/** When this room next needs `advance`, or null if it waits on people. */
export function deadline(room: Room): number | null {
  if (room.phase === 'closed') return null;
  if (room.phase === 'armed') return room.round?.closesAt ?? null;
  return room.phaseEndsAt;
}

function average(xs: number[]): number | null {
  return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

export interface Standing {
  id: string;
  name: string;
  score: number;
  bestMs: number | null;
  avgMs: number | null;
  falseStarts: number;
}

/** Most rounds first; a tie on rounds goes to the lower average. */
export function standings(room: Room): Standing[] {
  return room.players
    .filter((p) => p.status === 'joined' || p.reactions.length > 0 || p.falseStarts > 0)
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      bestMs: p.reactions.length ? Math.min(...p.reactions) : null,
      avgMs: average(p.reactions),
      falseStarts: p.falseStarts,
    }))
    .sort((a, b) => b.score - a.score || (a.avgMs ?? Infinity) - (b.avgMs ?? Infinity));
}

/** Nobody wins alone, and nobody wins with nothing. Exact ties share. */
export function winners(list: Standing[]): string[] {
  if (list.length < 2 || list[0].score === 0) return [];
  const top = list[0];
  return list.filter((s) => s.score === top.score && s.avgMs === top.avgMs).map((s) => s.id);
}

/** The room as one player's phone sees it: reaction times stay hidden until the round settles. */
export function toWire(room: Room, meId: string, now: number) {
  const r = room.round;
  const finished = room.phase === 'finished';
  const table = finished ? standings(room) : null;
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    rounds: room.rounds,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      score: p.score,
      isHost: p.id === room.hostId,
    })),
    phaseEndsAt: room.phaseEndsAt,
    round: r
      ? {
          number: r.number,
          goAt: r.goAt,
          windowMs: r.windowMs,
          closesAt: r.closesAt,
          decoys: r.decoys,
          responses:
            room.phase === 'armed'
              ? r.responses.map((x) => ({ playerId: x.playerId, reactionMs: null, early: false }))
              : r.responses,
          winnerId: room.phase === 'armed' ? null : r.winnerId,
        }
      : null,
    standings: table,
    winnerIds: table ? winners(table) : [],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;
