// Sequence Memory — Simon for the family, as pure functions over a room.
//
// Same shape as Tap Duel (`tap-duel.ts`): every function takes `now` (epoch ms)
// and, where it deals, a `rng`, so a whole game plays in a test without a clock.
// The live registry owns timers and fan-out; nothing here knows about either.
//
// One sequence per game, dealt from the rng: three flashes in round 1, and each
// later round appends one more. Every round has two halves. In `show` the server
// has already fixed when each flash starts and ends (`steps[].at`) and sent the
// whole round AHEAD, so every phone flashes in sync whatever its latency — Tap
// Duel's `goAt`, many times over. In `input` the sequence is no longer on the
// wire: a phone that missed the show has only what its player remembers, which
// is the game. Each player still alive posts their whole attempt once; a wrong
// or missing one puts them out, keeping the best length they reached.
//
// The game ends when nobody is left, or once a round of MAX_LENGTH is played.
// The last player(s) standing win; players who go out in the same round share.
//
// The lobby (join / decline / leave / start / again) behaves exactly as Tap
// Duel's does. It is re-stated rather than imported because those functions are
// typed to Tap Duel's room (see `wordle-race.ts`).

import {
  COUNTDOWN_MS,
  FINISHED_MS,
  GameError,
  LOBBY_MS,
  MAX_PLAYERS,
  isDifficulty,
  DIFFICULTIES,
  type Difficulty,
  type PlayerStatus,
  type Rng,
} from './tap-duel';

export { COUNTDOWN_MS, FINISHED_MS, GameError, LOBBY_MS, MAX_PLAYERS, isDifficulty, DIFFICULTIES };
export type { Difficulty, PlayerStatus, Rng };

export type Phase = 'lobby' | 'countdown' | 'show' | 'input' | 'result' | 'finished' | 'closed';

export const START_LENGTH = 3;
export const MAX_LENGTH = 20;
export const RESULT_MS = 2_000;
export const GAP_MS = 150;
/** Between the frame that deals a round and its first flash, so it lands first. */
export const SHOW_LEAD_MS = 1_000;
export const WINDOW_BASE_MS = 2_000;
export const WINDOW_PER_STEP_MS = 800;
/** After the input window closes, how long an attempt already in flight may still land. */
export const GRACE_MS = 1_000;

interface Tuning {
  tiles: number;
  stepMs: number;
}

export const TUNING: Record<Difficulty, Tuning> = {
  easy: { tiles: 4, stepMs: 700 },
  medium: { tiles: 6, stepMs: 550 },
  hard: { tiles: 9, stepMs: 400 },
};

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  /** Seated when round 1 was dealt: only these are in the game's standings. */
  playing: boolean;
  alive: boolean;
  /** Longest sequence repeated correctly; 0 until one is. */
  best: number;
  roundsSurvived: number;
  /** The round they went out in (a wrong or missing attempt, or leaving), null while alive. */
  outRound: number | null;
}

export interface Step {
  tile: number;
  at: number;
  ms: number;
}

export interface Attempt {
  playerId: string;
  /** Null when the window closed without one. */
  taps: number[] | null;
  correct: boolean;
}

export interface Round {
  number: number;
  length: number;
  showAt: number;
  stepMs: number;
  gapMs: number;
  steps: Step[];
  /** The show is over and the input window opens. */
  inputAt: number;
  windowMs: number;
  /** The window as the phone counts it down. */
  inputEndsAt: number;
  /** The window plus grace: when the round settles if not everyone has answered. */
  closesAt: number;
  attempts: Attempt[];
}

export interface Room {
  id: string;
  game: 'sequence-memory';
  difficulty: Difficulty;
  hostId: string;
  phase: Phase;
  players: Player[];
  tiles: number;
  /** The whole game's sequence so far; round n plays its first START_LENGTH + n - 1. */
  sequence: number[];
  round: Round | null;
  /** Lobby expiry, countdown end, show end, input window end, result end, finished expiry. */
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, playing: false, alive: false, best: 0, roundsSurvived: 0, outRound: null };
}

function reset(p: Player): void {
  p.playing = false;
  p.alive = false;
  p.best = 0;
  p.roundsSurvived = 0;
  p.outRound = null;
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
  options?: Record<string, unknown>;
  now: number;
}): Room {
  const invited = input.invite.filter((p, i, all) => p.id !== input.host.id && all.findIndex((q) => q.id === p.id) === i);
  if (invited.length > MAX_PLAYERS - 1) {
    throw new GameError(400, `Up to ${MAX_PLAYERS} players.`);
  }
  return {
    id: input.id,
    game: 'sequence-memory',
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: 'lobby',
    players: [player(input.host.id, input.host.name, 'joined'), ...invited.map((p) => player(p.id, p.name, 'invited'))],
    tiles: TUNING[input.difficulty].tiles,
    sequence: [],
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
 * Leaving the lobby as host cancels the game; leaving later hands the host role
 * on, and the last one out closes the room — as Tap Duel. Leaving mid-game is
 * going out in this round, and the round may now have everyone's answer.
 */
export function leave(room: Room, playerId: string, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'joined') return;
  p.status = 'left';
  if (p.alive) {
    p.alive = false;
    p.outRound = room.round?.number ?? 0;
  }
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
  if (room.phase === 'show' || room.phase === 'input') settleIfAnswered(room, now);
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
    reset(p);
  }
  room.phase = 'lobby';
  room.sequence = [];
  room.round = null;
  room.phaseEndsAt = now + LOBBY_MS;
  room.createdAt = now;
  room.updatedAt = now;
}

function dealTile(tiles: number, rng: Rng): number {
  return Math.min(tiles - 1, Math.max(0, Math.floor(rng() * tiles)));
}

/** The input window for a sequence of this length. */
export function windowFor(length: number): number {
  return WINDOW_BASE_MS + WINDOW_PER_STEP_MS * length;
}

/**
 * Time a round of `sequence` (its full current length) from `now`. Flash i runs
 * from `showAt + i·(step + gap)` for `step` ms; the window opens when the last
 * flash ends.
 */
export function dealRound(number: number, sequence: number[], difficulty: Difficulty, now: number): Round {
  const { stepMs } = TUNING[difficulty];
  const showAt = now + SHOW_LEAD_MS;
  const steps = sequence.map((tile, i) => ({ tile, at: showAt + i * (stepMs + GAP_MS), ms: stepMs }));
  const inputAt = showAt + sequence.length * stepMs + (sequence.length - 1) * GAP_MS;
  const windowMs = windowFor(sequence.length);
  return {
    number,
    length: sequence.length,
    showAt,
    stepMs,
    gapMs: GAP_MS,
    steps,
    inputAt,
    windowMs,
    inputEndsAt: inputAt + windowMs,
    closesAt: inputAt + windowMs + GRACE_MS,
    attempts: [],
  };
}

function nextRound(room: Room, now: number, rng: Rng): void {
  const number = (room.round?.number ?? 0) + 1;
  const want = START_LENGTH + number - 1;
  while (room.sequence.length < want) room.sequence.push(dealTile(room.tiles, rng));
  room.round = dealRound(number, room.sequence.slice(0, want), room.difficulty, now);
  room.phase = 'show';
  room.phaseEndsAt = room.round.inputAt;
  room.updatedAt = now;
}

/**
 * A player's whole attempt at this round, once. Accepted from the moment the
 * round is dealt until it closes — an attempt posted before the show ends can
 * only hold what its player has already seen. Idempotent: a second post is
 * ignored, so a phone retrying a lost response costs nothing.
 */
export function attempt(room: Room, playerId: string, input: { round: number; taps: unknown }, now: number): void {
  const p = find(room, playerId);
  if (p.status !== 'joined') throw new GameError(403, 'You are not playing this game.');
  const r = room.round;
  if ((room.phase !== 'show' && room.phase !== 'input') || !r || r.number !== input.round || now > r.closesAt) {
    throw new GameError(409, 'That round is over.');
  }
  if (!p.alive) throw new GameError(409, 'You are out of this game.');
  if (r.attempts.some((x) => x.playerId === playerId)) return;

  const taps = input.taps;
  if (!Array.isArray(taps) || taps.length > r.length) {
    throw new GameError(400, `An attempt is up to ${r.length} taps.`);
  }
  if (!taps.every((t) => Number.isInteger(t) && t >= 0 && t < room.tiles)) {
    throw new GameError(400, `Tiles are 0 to ${room.tiles - 1}.`);
  }
  const seq = r.steps.map((s) => s.tile);
  const correct = taps.length === seq.length && taps.every((t, i) => t === seq[i]);
  r.attempts.push({ playerId, taps: [...(taps as number[])], correct });
  room.updatedAt = now;
  settleIfAnswered(room, now);
}

function settleIfAnswered(room: Room, now: number): void {
  const r = room.round;
  if (!r) return;
  const answered = new Set(r.attempts.map((x) => x.playerId));
  if (room.players.filter((p) => p.alive).every((p) => answered.has(p.id))) settle(room, now);
}

/** Close the round: anyone alive without a right answer is out. */
function settle(room: Room, now: number): void {
  const r = room.round!;
  for (const p of room.players) {
    if (!p.alive) continue;
    const a = r.attempts.find((x) => x.playerId === p.id);
    if (!a) r.attempts.push({ playerId: p.id, taps: null, correct: false });
    if (a?.correct) {
      p.best = r.length;
      p.roundsSurvived++;
    } else {
      p.alive = false;
      p.outRound = r.number;
    }
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
        for (const p of room.players) {
          reset(p);
          if (p.status === 'joined') {
            p.playing = true;
            p.alive = true;
          }
        }
        room.sequence = [];
        room.round = null;
        nextRound(room, due, rng);
        break;
      case 'show':
        room.phase = 'input';
        room.phaseEndsAt = room.round!.inputEndsAt;
        room.updatedAt = due;
        break;
      case 'input':
        settle(room, due);
        break;
      case 'result':
        if (!room.players.some((p) => p.alive) || (room.round?.length ?? 0) >= MAX_LENGTH) {
          room.phase = 'finished';
          room.phaseEndsAt = due + FINISHED_MS;
          room.updatedAt = due;
        } else {
          nextRound(room, due, rng);
        }
        break;
    }
  }
  return changed;
}

/** When this room next needs `advance`, or null if it waits on people. */
export function deadline(room: Room): number | null {
  if (room.phase === 'closed') return null;
  // The phone counts down to the window's end; the room waits out the grace too.
  if (room.phase === 'input') return room.round?.closesAt ?? null;
  return room.phaseEndsAt;
}

export interface Standing {
  id: string;
  name: string;
  best: number;
  roundsSurvived: number;
  outRound: number | null;
}

/** Everyone who played, longest-lasting first. */
export function standings(room: Room): Standing[] {
  return room.players
    .filter((p) => p.playing)
    .map((p) => ({ id: p.id, name: p.name, best: p.best, roundsSurvived: p.roundsSurvived, outRound: p.outRound }))
    .sort((a, b) => (b.outRound ?? Infinity) - (a.outRound ?? Infinity) || b.best - a.best);
}

/**
 * Last standing wins: everyone still alive at the length cap, else everyone who
 * went out in the last round anyone went out in. Nobody wins alone (solo's
 * result is the best length), nobody wins having repeated nothing, and a
 * player who left cannot win.
 */
export function winners(room: Room): string[] {
  const played = room.players.filter((p) => p.playing);
  if (played.length < 2) return [];
  const stayed = played.filter((p) => p.status === 'joined');
  const alive = stayed.filter((p) => p.alive);
  if (alive.length) return alive.map((p) => p.id);
  const last = Math.max(0, ...stayed.map((p) => p.outRound ?? 0));
  const top = stayed.filter((p) => p.outRound === last);
  if (!top.length || top.every((p) => p.best === 0)) return [];
  return top.map((p) => p.id);
}

/**
 * The room as one player's phone sees it. The sequence travels during `show`
 * (sent ahead, so phones flash in sync) and again once the round settles —
 * never during `input`. Who has answered is public; what they answered waits
 * for the result.
 */
export function toWire(room: Room, meId: string, now: number) {
  const r = room.round;
  const finished = room.phase === 'finished';
  const settled = room.phase === 'result' || finished || room.phase === 'closed';
  const showing = room.phase === 'show' || settled;
  const table = finished ? standings(room) : null;
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    tiles: room.tiles,
    startLength: START_LENGTH,
    maxLength: MAX_LENGTH,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      playing: p.playing,
      alive: p.alive,
      best: p.best,
      roundsSurvived: p.roundsSurvived,
      outRound: p.outRound,
    })),
    phaseEndsAt: room.phaseEndsAt,
    round: r
      ? {
          number: r.number,
          length: r.length,
          showAt: r.showAt,
          stepMs: r.stepMs,
          gapMs: r.gapMs,
          steps: showing ? r.steps : null,
          inputAt: r.inputAt,
          windowMs: r.windowMs,
          inputEndsAt: r.inputEndsAt,
          closesAt: r.closesAt,
          answeredIds: r.attempts.filter((a) => a.taps !== null).map((a) => a.playerId),
          attempts: settled ? r.attempts : null,
          survivorIds: settled ? room.players.filter((p) => p.alive).map((p) => p.id) : null,
        }
      : null,
    standings: table,
    winnerIds: finished ? winners(room) : [],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;
