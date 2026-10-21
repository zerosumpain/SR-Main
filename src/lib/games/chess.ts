// Chess — the rules of the family game, as pure functions over a room.
//
// Same shape as Liar's Dice (`liars-dice.ts`): every function takes `now`
// (epoch ms) and the seating one a `rng`, so a whole game plays in a test
// without a clock. The live registry owns timers and fan-out; nothing here
// knows about either. The laws of chess themselves live in `chess-engine.ts`.
//
// Two players, a clock each. The difficulty is the time control: how much
// each side has for the whole game, plus a little back on every move. Run out
// and you lose — unless the other side has nothing that could ever mate, in
// which case it is a draw, as over the board. Checkmate, stalemate, the
// fifty-move rule, threefold repetition and bare kings end the game by
// themselves; either player may resign, or offer a draw the other accepts.
//
// There is no turn clock to auto-move for you: a chess move made by the server
// would be a different game. The clock is the whole of the pressure.
//
// Colours: the first game is decided by the rng; "Play again" swaps them
// when the same two sit down.

import {
  COUNTDOWN_MS,
  FINISHED_MS,
  GameError,
  LOBBY_MS,
  isDifficulty,
  DIFFICULTIES,
  type Difficulty,
  type PlayerStatus,
  type Rng,
} from './tap-duel';
import {
  applyMove,
  canMate,
  ending,
  findMove,
  inCheck,
  isPromotion,
  legalMoves,
  other,
  repetitionKey,
  san,
  squareIndex,
  squareName,
  startPosition,
  toFen,
  type Colour,
  type Move,
  type PieceKind,
  type Position,
  type Ending,
} from './chess-engine';

export { COUNTDOWN_MS, FINISHED_MS, GameError, LOBBY_MS, isDifficulty, DIFFICULTIES };
export type { Difficulty, PlayerStatus, Rng, Colour };

export type Phase = 'lobby' | 'countdown' | 'playing' | 'finished' | 'closed';

/** The time control: the whole game's clock, and what comes back each move. */
export const CLOCK: Record<Difficulty, { mainMs: number; incrementMs: number }> = {
  easy: { mainMs: 15 * 60_000, incrementMs: 10_000 },
  medium: { mainMs: 10 * 60_000, incrementMs: 5_000 },
  hard: { mainMs: 5 * 60_000, incrementMs: 3_000 },
};

/** The time control in a sentence, for the lobby and the invite banner. */
export function clockLine(difficulty: Difficulty): string {
  const { mainMs, incrementMs } = CLOCK[difficulty];
  return `${mainMs / 60_000} min each · +${incrementMs / 1000} s a move`;
}

export type Outcome = Ending | 'resigned' | 'timeout' | 'agreed' | 'left';

// ---- The room ------------------------------------------------------------

export interface Player {
  id: string;
  name: string;
  status: PlayerStatus;
  /** Sat at the board when play started: the two the game is between. */
  seated: boolean;
  colour: Colour | null;
  /**
   * Time left on their clock when their current turn began (or when their
   * last one ended). Live remaining time = this, less the time since
   * `turnStartedAt` while it is their move.
   */
  clockMs: number;
}

export interface PlayedMove {
  san: string;
  from: string;
  to: string;
  colour: Colour;
  at: number;
}

export interface Result {
  outcome: Outcome;
  /** Null for a draw. */
  winnerId: string | null;
}

export interface Room {
  id: string;
  game: 'chess';
  difficulty: Difficulty;
  hostId: string;
  phase: Phase;
  players: Player[];
  position: Position;
  moves: PlayedMove[];
  /** Captured by white / by black, in order taken. */
  captured: { w: PieceKind[]; b: PieceKind[] };
  /** How often each position has stood, for the repetition rule. */
  seen: Record<string, number>;
  /** When the side to move's clock started running; null when nobody's is. */
  turnStartedAt: number | null;
  /** A standing draw offer, by whom. Lapses when the other side moves. */
  drawOfferBy: string | null;
  result: Result | null;
  /** Who had white last time, so "Play again" swaps. */
  lastWhiteId: string | null;
  /** When play began (the countdown's end); null before. */
  startedAt: number | null;
  /** Lobby expiry, countdown end, the side to move's flag, finished expiry. */
  phaseEndsAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function player(id: string, name: string, status: PlayerStatus): Player {
  return { id, name, status, seated: false, colour: null, clockMs: 0 };
}

export function joined(room: Room): Player[] {
  return room.players.filter((p) => p.status === 'joined');
}

/** The two at the board, white first. */
export function seated(room: Room): Player[] {
  return room.players.filter((p) => p.seated).sort((a, b) => (a.colour === 'w' ? -1 : b.colour === 'w' ? 1 : 0));
}

function find(room: Room, playerId: string): Player {
  const p = room.players.find((x) => x.id === playerId);
  if (!p) throw new GameError(403, 'You are not in this game.');
  return p;
}

function byColour(room: Room, colour: Colour): Player | null {
  return room.players.find((p) => p.seated && p.colour === colour) ?? null;
}

/** Whose move it is, while playing. */
export function toMove(room: Room): Player | null {
  return room.phase === 'playing' ? byColour(room, room.position.turn) : null;
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
  if (invited.length > 1) throw new GameError(400, 'Chess is for two: invite one person.');
  return {
    id: input.id,
    game: 'chess',
    difficulty: input.difficulty,
    hostId: input.host.id,
    phase: 'lobby',
    players: [player(input.host.id, input.host.name, 'joined'), ...invited.map((p) => player(p.id, p.name, 'invited'))],
    position: startPosition(),
    moves: [],
    captured: { w: [], b: [] },
    seen: {},
    turnStartedAt: null,
    drawOfferBy: null,
    result: null,
    lastWhiteId: null,
    startedAt: null,
    phaseEndsAt: input.now + LOBBY_MS,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** The invite banner's line: "10 min each · +5 s a move". */
export function about(room: Room): string {
  return clockLine(room.difficulty);
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

function close(room: Room, now: number): void {
  room.phase = 'closed';
  room.turnStartedAt = null;
  room.phaseEndsAt = null;
  room.updatedAt = now;
}

/** Stop the running clock, so a finished game shows the time it ended on. */
function freezeClock(room: Room, now: number): void {
  const mover = toMove(room);
  if (mover && room.turnStartedAt !== null) mover.clockMs = Math.max(0, mover.clockMs - (now - room.turnStartedAt));
  room.turnStartedAt = null;
}

function finish(room: Room, result: Result, now: number): void {
  freezeClock(room, now);
  room.result = result;
  room.drawOfferBy = null;
  room.lastWhiteId = byColour(room, 'w')?.id ?? room.lastWhiteId;
  room.phase = 'finished';
  room.phaseEndsAt = now + FINISHED_MS;
  room.updatedAt = now;
}

/**
 * Leaving the lobby as host cancels the game. Leaving later hands the host
 * role to the other player, and the last one out closes the room. Leaving a
 * game in play forfeits it.
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
  if (room.phase !== 'playing' || !p.seated) return;
  const opponent = room.players.find((x) => x.seated && x.id !== p.id);
  finish(room, { outcome: 'left', winnerId: opponent?.status === 'joined' ? opponent.id : null }, now);
}

export function start(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start.');
  if (room.phase !== 'lobby') throw new GameError(409, 'That game has already started.');
  const in_ = joined(room);
  if (in_.length < 2) throw new GameError(409, 'Chess needs two players.');
  if (in_.length > 2) throw new GameError(409, 'Chess is for two: ask the others to leave.');
  for (const p of room.players) if (p.status === 'invited') p.status = 'declined';
  room.phase = 'countdown';
  room.phaseEndsAt = now + COUNTDOWN_MS;
  room.updatedAt = now;
}

/** The host plays again — same clock, colours swapped — with whoever is still here; everyone else is asked again. */
export function again(room: Room, playerId: string, now: number): void {
  if (playerId !== room.hostId) throw new GameError(403, 'Only the host can start another.');
  if (room.phase !== 'finished') throw new GameError(409, 'This game is still going.');
  for (const p of room.players) {
    p.status = p.status === 'joined' ? 'joined' : 'invited';
    p.seated = false;
    p.colour = null;
    p.clockMs = 0;
  }
  room.phase = 'lobby';
  room.position = startPosition();
  room.moves = [];
  room.captured = { w: [], b: [] };
  room.seen = {};
  room.turnStartedAt = null;
  room.drawOfferBy = null;
  room.result = null;
  room.startedAt = null;
  room.phaseEndsAt = now + LOBBY_MS;
  room.createdAt = now;
  room.updatedAt = now;
}

// ---- Play ----------------------------------------------------------------

/** Sit the two players down and give white the move. */
function seat(room: Room, now: number, rng: Rng): void {
  const in_ = joined(room).slice(0, 2);
  for (const p of room.players) {
    p.seated = false;
    p.colour = null;
    p.clockMs = 0;
  }
  if (in_.length < 2) return;
  // Swap when the same two meet again; otherwise the rng decides.
  const bothBack = room.lastWhiteId !== null && in_.some((p) => p.id === room.lastWhiteId);
  const whiteIndex = bothBack ? (in_[0].id === room.lastWhiteId ? 1 : 0) : rng() < 0.5 ? 0 : 1;
  in_.forEach((p, i) => {
    p.seated = true;
    p.colour = i === whiteIndex ? 'w' : 'b';
    p.clockMs = CLOCK[room.difficulty].mainMs;
  });
  room.position = startPosition();
  room.moves = [];
  room.captured = { w: [], b: [] };
  room.seen = { [repetitionKey(room.position)]: 1 };
  room.drawOfferBy = null;
  room.result = null;
  room.startedAt = now;
  room.phase = 'playing';
  room.turnStartedAt = now;
  room.phaseEndsAt = now + CLOCK[room.difficulty].mainMs;
  room.updatedAt = now;
}

/** The side to move's flag has fallen. */
function flag(room: Room, now: number): void {
  const loser = toMove(room);
  if (!loser) return;
  loser.clockMs = 0;
  room.turnStartedAt = null;
  const winner = byColour(room, other(loser.colour as Colour));
  // Nothing that could ever mate: no win on time, as over the board.
  const wins = !!winner && canMate(room.position.board, winner.colour as Colour);
  finish(room, { outcome: 'timeout', winnerId: wins ? winner.id : null }, now);
}

function assertSeated(room: Room, playerId: string): Player {
  const p = find(room, playerId);
  if (p.status !== 'joined' || !p.seated) throw new GameError(403, 'You are not playing this game.');
  if (room.phase !== 'playing') {
    throw new GameError(409, room.phase === 'finished' ? 'That game is over.' : 'The game has not started.');
  }
  return p;
}

/**
 * Make a move on your turn: `{ from: "e2", to: "e4" }`, plus `promotion`
 * (q | r | b | n) for a pawn reaching the last rank. An illegal move is refused
 * (400) with a sentence and costs nothing; off-turn is 409. Your clock is
 * charged for the time you took; if it has already run out, you lose on time
 * instead of moving.
 */
export function move(
  room: Room,
  playerId: string,
  input: { from: unknown; to: unknown; promotion?: unknown },
  now: number,
): void {
  const p = assertSeated(room, playerId);
  if (room.position.turn !== p.colour) throw new GameError(409, "It's not your turn.");
  const from = squareIndex(input.from);
  const to = squareIndex(input.to);
  if (from === null || to === null) throw new GameError(400, 'Name the square to move from and the square to move to.');
  const piece = room.position.board[from];
  if (!piece || piece.colour !== p.colour) throw new GameError(400, 'That is not one of your pieces.');
  const legal = legalMoves(room.position);
  const found = findMove(legal, from, to, isPromotion(input.promotion) ? input.promotion : null);
  if (found === 'none') {
    throw new GameError(400, inCheck(room.position) ? 'You are in check: that move leaves your king in it.' : 'That piece cannot move there.');
  }
  if (found === 'promotion') throw new GameError(400, 'Say what the pawn becomes: queen, rook, bishop or knight.');

  const spent = room.turnStartedAt === null ? 0 : now - room.turnStartedAt;
  p.clockMs -= spent;
  if (p.clockMs <= 0) {
    flag(room, now);
    return;
  }
  p.clockMs += CLOCK[room.difficulty].incrementMs;
  play(room, p, found, legal, now);
}

function play(room: Room, p: Player, m: Move, legal: readonly Move[], now: number): void {
  const text = san(room.position, m, legal);
  if (m.captured) room.captured[p.colour as Colour].push(m.captured);
  room.position = applyMove(room.position, m);
  room.moves.push({ san: text, from: squareName(m.from), to: squareName(m.to), colour: p.colour as Colour, at: now });
  const nextLegal = legalMoves(room.position);
  const key = repetitionKey(room.position, nextLegal);
  room.seen[key] = (room.seen[key] ?? 0) + 1;
  // An offer from the other side lapses when you move instead of taking it.
  if (room.drawOfferBy !== null && room.drawOfferBy !== p.id) room.drawOfferBy = null;
  room.updatedAt = now;
  const end = ending(room.position, nextLegal, room.seen[key]);
  if (end) {
    room.turnStartedAt = null;
    finish(room, { outcome: end, winnerId: end === 'checkmate' ? p.id : null }, now);
    return;
  }
  const next = toMove(room);
  room.turnStartedAt = now;
  room.phaseEndsAt = now + (next?.clockMs ?? 0);
}

/** Give up: the other player wins. Allowed on either side's turn. */
export function resign(room: Room, playerId: string, now: number): void {
  const p = assertSeated(room, playerId);
  const opponent = room.players.find((x) => x.seated && x.id !== p.id);
  finish(room, { outcome: 'resigned', winnerId: opponent?.id ?? null }, now);
}

/**
 * Offer a draw, or accept the other side's standing offer. An offer stands
 * until they move or the game ends; offering again while it stands does nothing.
 */
export function draw(room: Room, playerId: string, now: number): void {
  const p = assertSeated(room, playerId);
  if (room.drawOfferBy === p.id) return;
  if (room.drawOfferBy !== null) {
    finish(room, { outcome: 'agreed', winnerId: null }, now);
    return;
  }
  room.drawOfferBy = p.id;
  room.updatedAt = now;
}

/**
 * Move a room along the clock: whatever deadline has passed, act on it.
 * Returns whether anything changed. One step per call, each next deadline
 * set from `now`, so a far-future `now` cannot run the game away.
 */
export function advance(room: Room, now: number, rng: Rng): boolean {
  if (!Number.isFinite(now)) return false;
  const due = deadline(room);
  if (due === null || due > now) return false;
  switch (room.phase) {
    case 'lobby':
    case 'finished':
      close(room, due);
      break;
    case 'countdown':
      seat(room, now, rng);
      // Somebody left during the countdown: the one still here has it.
      if (room.players.filter((p) => p.seated).length < 2) {
        const [only] = joined(room);
        finish(room, { outcome: 'left', winnerId: only?.id ?? null }, now);
      }
      break;
    case 'playing':
      flag(room, now);
      break;
  }
  return true;
}

/** When this room next needs `advance`, or null if it waits on people. */
export function deadline(room: Room): number | null {
  if (room.phase === 'closed' || room.phaseEndsAt === null) return null;
  return room.phaseEndsAt;
}

// ---- Result --------------------------------------------------------------

export interface Standing {
  id: string;
  name: string;
  /** 1 for the winner, 2 for the loser; both 1 in a draw. */
  place: number;
  colour: Colour | null;
  result: 'won' | 'lost' | 'drew';
  /** Time left at the end, ms. */
  clockMs: number;
}

/** The winner first; in a draw, white first. */
export function standings(room: Room): Standing[] {
  const winnerId = room.result?.winnerId ?? null;
  const order = [...seated(room)].sort((a, b) => (a.id === winnerId ? -1 : b.id === winnerId ? 1 : 0));
  return order.map((p) => ({
    id: p.id,
    name: p.name,
    place: winnerId === null || p.id === winnerId ? 1 : 2,
    colour: p.colour,
    result: winnerId === null ? 'drew' : p.id === winnerId ? 'won' : 'lost',
    clockMs: p.clockMs,
  }));
}

export function winners(room: Room): string[] {
  return room.result?.winnerId ? [room.result.winnerId] : [];
}

/** The move list's last square pair, for the board's highlight. */
function lastMove(room: Room): { from: string; to: string } | null {
  const m = room.moves[room.moves.length - 1];
  return m ? { from: m.from, to: m.to } : null;
}

/**
 * The room as one player's phone sees it. Nothing is hidden in chess; what
 * differs by viewer is `legal`, the moves the side to move may make — sent
 * only to that player, so a phone never needs the rules to light the board.
 */
export function toWire(room: Room, meId: string, now: number) {
  const finished = room.phase === 'finished';
  const playing = room.phase === 'playing';
  const mover = toMove(room);
  const white = byColour(room, 'w');
  const black = byColour(room, 'b');
  const myTurn = playing && mover?.id === meId;
  const legal = myTurn
    ? Object.values(
        legalMoves(room.position).reduce<Record<string, { from: string; to: string; promotes: boolean }>>((acc, m) => {
          const key = `${m.from}-${m.to}`;
          acc[key] ??= { from: squareName(m.from), to: squareName(m.to), promotes: m.promotion !== null };
          return acc;
        }, {}),
      )
    : [];
  return {
    id: room.id,
    game: room.game,
    difficulty: room.difficulty,
    phase: room.phase,
    hostId: room.hostId,
    meId,
    mainMs: CLOCK[room.difficulty].mainMs,
    incrementMs: CLOCK[room.difficulty].incrementMs,
    rule: clockLine(room.difficulty),
    startedAt: room.startedAt,
    phaseEndsAt: room.phaseEndsAt,
    fen: toFen(room.position),
    turn: room.position.turn,
    turnId: mover?.id ?? null,
    turnStartedAt: room.turnStartedAt,
    check: playing || finished ? inCheck(room.position) : false,
    whiteId: white?.id ?? null,
    blackId: black?.id ?? null,
    clocks: { w: white?.clockMs ?? 0, b: black?.clockMs ?? 0 },
    moves: room.moves.map((m) => m.san),
    lastMove: lastMove(room),
    captured: { w: [...room.captured.w], b: [...room.captured.b] },
    legal,
    drawOfferBy: room.drawOfferBy,
    result: room.result ? { ...room.result } : null,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      isHost: p.id === room.hostId,
      seated: p.seated,
      colour: p.colour,
      clockMs: p.clockMs,
    })),
    standings: finished ? standings(room) : null,
    winnerIds: finished ? winners(room) : [],
    serverNow: now,
  };
}

export type WireRoom = ReturnType<typeof toWire>;
