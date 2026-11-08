import { describe, expect, it } from 'vitest';
import {
  CLOCK,
  COUNTDOWN_MS,
  FINISHED_MS,
  LOBBY_MS,
  about,
  advance,
  again,
  createRoom,
  deadline,
  draw,
  join,
  leave,
  move,
  resign,
  standings,
  start,
  toMove,
  toWire,
  winners,
  type Difficulty,
  type Room,
} from './chess';
import { fromFen } from './chess-engine';

const T0 = 1_790_000_000_000;
/** `rng() < 0.5` seats the host as white. */
const hostWhite = () => 0.1;
const hostBlack = () => 0.9;

const JOHN = { id: 'p_john', name: 'John' };
const SAM = { id: 'p_sam', name: 'Sam' };
const KIM = { id: 'p_kim', name: 'Kim' };

function room(invite = [SAM], difficulty: Difficulty = 'medium'): Room {
  return createRoom({ id: 'g_1', host: JOHN, invite, difficulty, now: T0 });
}

/** Everyone joins, the host starts, the countdown runs down. Returns the clock at the first move. */
function playing(r: Room, rng = hostWhite): number {
  for (const p of r.players) if (p.status === 'invited') join(r, p.id, T0);
  start(r, JOHN.id, T0);
  advance(r, T0 + COUNTDOWN_MS, rng);
  return T0 + COUNTDOWN_MS;
}

const white = (r: Room) => r.players.find((p) => p.colour === 'w')!;
const black = (r: Room) => r.players.find((p) => p.colour === 'b')!;

describe('the lobby', () => {
  it('is for two: a second invitee is refused, and start needs exactly two', () => {
    expect(() => createRoom({ id: 'g', host: JOHN, invite: [SAM, KIM], difficulty: 'easy', now: T0 })).toThrow(/for two/);
    const r = room();
    expect(() => start(r, JOHN.id, T0)).toThrow(/needs two/);
    join(r, SAM.id, T0);
    start(r, JOHN.id, T0);
    expect(r.phase).toBe('countdown');
  });

  it('says what the clock is', () => {
    expect(about(room([SAM], 'easy'))).toBe('15 min each · +10 s a move');
    expect(about(room([SAM], 'hard'))).toBe('5 min each · +3 s a move');
  });

  it('seats both with full clocks and white to move, the rng picking colours', () => {
    const r = room();
    const t = playing(r, hostBlack);
    expect(r.phase).toBe('playing');
    expect(white(r).id).toBe(SAM.id);
    expect(black(r).id).toBe(JOHN.id);
    expect(white(r).clockMs).toBe(CLOCK.medium.mainMs);
    expect(toMove(r)?.id).toBe(SAM.id);
    expect(r.turnStartedAt).toBe(t);
    expect(deadline(r)).toBe(t + CLOCK.medium.mainMs);
    const other = room();
    playing(other, hostWhite);
    expect(white(other).id).toBe(JOHN.id);
  });

  it('closes an unanswered lobby', () => {
    const r = room();
    expect(advance(r, T0 + LOBBY_MS, hostWhite)).toBe(true);
    expect(r.phase).toBe('closed');
  });
});

describe('moving', () => {
  it('refuses off-turn, the wrong piece, an illegal square and a nameless promotion', () => {
    const r = room();
    const t = playing(r, hostWhite);
    expect(() => move(r, SAM.id, { from: 'e7', to: 'e5' }, t)).toThrow(/not your turn/);
    expect(() => move(r, JOHN.id, { from: 'e7', to: 'e5' }, t)).toThrow(/not one of your pieces/);
    expect(() => move(r, JOHN.id, { from: 'e2', to: 'e5' }, t)).toThrow(/cannot move there/);
    expect(() => move(r, JOHN.id, { from: 'e2', to: 'x9' }, t)).toThrow(/Name the square/);
    expect(() => move(r, KIM.id, { from: 'e2', to: 'e4' }, t)).toThrow(/not in this game/);
  });

  it('plays a move, charges the clock, adds the increment and hands the turn over', () => {
    const r = room();
    const t = playing(r, hostWhite);
    move(r, JOHN.id, { from: 'e2', to: 'e4' }, t + 7_000);
    expect(r.moves.map((m) => m.san)).toEqual(['e4']);
    expect(white(r).clockMs).toBe(CLOCK.medium.mainMs - 7_000 + CLOCK.medium.incrementMs);
    expect(toMove(r)?.id).toBe(SAM.id);
    expect(r.turnStartedAt).toBe(t + 7_000);
    expect(deadline(r)).toBe(t + 7_000 + CLOCK.medium.mainMs);
    const w = toWire(r, SAM.id, t + 8_000);
    expect(w.turn).toBe('b');
    expect(w.turnId).toBe(SAM.id);
    expect(w.lastMove).toEqual({ from: 'e2', to: 'e4' });
    expect(w.legal.length).toBe(20);
    expect(toWire(r, JOHN.id, t + 8_000).legal).toEqual([]);
  });

  it('explains a move that leaves the king in check, and takes the one that answers it', () => {
    // A black rook on e2 checks the king on e1: stepping to d2 stays on the rook's rank.
    const r = room();
    const t = playing(r, hostWhite);
    r.position = fromFen('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1');
    expect(() => move(r, JOHN.id, { from: 'e1', to: 'd2' }, t)).toThrow(/in check/);
    move(r, JOHN.id, { from: 'e1', to: 'e2' }, t);
    expect(r.moves[0].san).toBe('Kxe2');
  });

  it('records captures for each side', () => {
    const r = room();
    let t = playing(r, hostWhite);
    for (const [who, from, to] of [
      [JOHN.id, 'e2', 'e4'], [SAM.id, 'd7', 'd5'], [JOHN.id, 'e4', 'd5'], [SAM.id, 'd8', 'd5'],
    ] as const) {
      move(r, who, { from, to }, (t += 1000));
    }
    expect(r.captured).toEqual({ w: ['p'], b: ['p'] });
    expect(r.moves.map((m) => m.san)).toEqual(['e4', 'd5', 'exd5', 'Qxd5']);
  });

  it('ends on checkmate with the mover winning, and the recorder sees it', () => {
    const r = room();
    let t = playing(r, hostWhite);
    for (const [who, from, to] of [
      [JOHN.id, 'f2', 'f3'], [SAM.id, 'e7', 'e5'], [JOHN.id, 'g2', 'g4'], [SAM.id, 'd8', 'h4'],
    ] as const) {
      move(r, who, { from, to }, (t += 1000));
    }
    expect(r.phase).toBe('finished');
    expect(r.result).toEqual({ outcome: 'checkmate', winnerId: SAM.id });
    expect(winners(r)).toEqual([SAM.id]);
    expect(r.moves.at(-1)?.san).toBe('Qh4#');
    expect(deadline(r)).toBe(t + FINISHED_MS);
    const s = standings(r);
    expect(s.map((x) => [x.id, x.place, x.result])).toEqual([[SAM.id, 1, 'won'], [JOHN.id, 2, 'lost']]);
    const w = toWire(r, JOHN.id, t);
    expect(w.standings).toHaveLength(2);
    expect(w.winnerIds).toEqual([SAM.id]);
    expect(w.check).toBe(true);
    expect(() => move(r, JOHN.id, { from: 'e2', to: 'e4' }, t)).toThrow(/over/);
  });

  it('promotes when told what to', () => {
    const r = room();
    const t = playing(r, hostWhite);
    r.position = fromFen('7k/P7/8/8/8/8/8/K7 w - - 0 1');
    expect(() => move(r, JOHN.id, { from: 'a7', to: 'a8' }, t)).toThrow(/what the pawn becomes/);
    move(r, JOHN.id, { from: 'a7', to: 'a8', promotion: 'q' }, t);
    expect(r.moves[0].san).toBe('a8=Q+');
    expect(toWire(r, SAM.id, t).fen.startsWith('Q6k/8')).toBe(true);
    expect(toWire(r, SAM.id, t).check).toBe(true);
  });

  it('draws by stalemate and by repetition', () => {
    const r = room();
    const t = playing(r, hostWhite);
    r.position = fromFen('7k/8/6K1/8/8/8/8/5Q2 w - - 0 1');
    move(r, JOHN.id, { from: 'f1', to: 'f7' }, t);
    expect(r.result).toEqual({ outcome: 'stalemate', winnerId: null });
    expect(standings(r).map((x) => [x.place, x.result])).toEqual([[1, 'drew'], [1, 'drew']]);
    expect(winners(r)).toEqual([]);

    const rep = room();
    let t2 = playing(rep, hostWhite);
    const shuffle = [
      [JOHN.id, 'g1', 'f3'], [SAM.id, 'g8', 'f6'], [JOHN.id, 'f3', 'g1'], [SAM.id, 'f6', 'g8'],
    ] as const;
    for (let i = 0; i < 2; i++) for (const [who, from, to] of shuffle) move(rep, who, { from, to }, (t2 += 1000));
    expect(rep.result).toEqual({ outcome: 'repetition', winnerId: null });
  });
});

describe('the clock', () => {
  it('flags the side to move when its time runs out, the other side winning', () => {
    const r = room([SAM], 'hard');
    const t = playing(r, hostWhite);
    expect(advance(r, t + CLOCK.hard.mainMs - 1, hostWhite)).toBe(false);
    expect(advance(r, t + CLOCK.hard.mainMs, hostWhite)).toBe(true);
    expect(r.phase).toBe('finished');
    expect(r.result).toEqual({ outcome: 'timeout', winnerId: SAM.id });
    expect(white(r).clockMs).toBe(0);
    expect(black(r).clockMs).toBe(CLOCK.hard.mainMs);
  });

  it('a move that lands after the flag loses on time rather than playing', () => {
    const r = room([SAM], 'hard');
    const t = playing(r, hostWhite);
    move(r, JOHN.id, { from: 'e2', to: 'e4' }, t + CLOCK.hard.mainMs + 5);
    expect(r.moves).toHaveLength(0);
    expect(r.result?.outcome).toBe('timeout');
    expect(r.result?.winnerId).toBe(SAM.id);
  });

  it('is a draw on time when the other side cannot mate', () => {
    const r = room([SAM], 'hard');
    const t = playing(r, hostWhite);
    // Black (Sam) runs out of time, but John has a bare king: nobody wins it.
    r.position = fromFen('7k/8/6K1/8/8/8/8/5r2 b - - 0 1');
    advance(r, t + CLOCK.hard.mainMs, hostWhite);
    expect(r.result).toEqual({ outcome: 'timeout', winnerId: null });
  });

  it('is frozen for the loser when the game ends', () => {
    const r = room();
    const t = playing(r, hostWhite);
    resign(r, JOHN.id, t + 30_000);
    expect(white(r).clockMs).toBe(CLOCK.medium.mainMs - 30_000);
    expect(r.turnStartedAt).toBeNull();
  });
});

describe('resigning, draws and leaving', () => {
  it('resign hands the game to the other side, on either turn', () => {
    const r = room();
    const t = playing(r, hostWhite);
    resign(r, SAM.id, t);
    expect(r.result).toEqual({ outcome: 'resigned', winnerId: JOHN.id });
    expect(standings(r)[0].id).toBe(JOHN.id);
  });

  it('a draw offer stands until the other side moves, and is a draw when accepted', () => {
    const r = room();
    let t = playing(r, hostWhite);
    draw(r, JOHN.id, (t += 1000));
    expect(r.drawOfferBy).toBe(JOHN.id);
    draw(r, JOHN.id, (t += 1000));
    expect(r.drawOfferBy).toBe(JOHN.id);
    // White moves: the offer stands for black to take.
    move(r, JOHN.id, { from: 'e2', to: 'e4' }, (t += 1000));
    expect(r.drawOfferBy).toBe(JOHN.id);
    // Black moves instead: the offer lapses.
    move(r, SAM.id, { from: 'e7', to: 'e5' }, (t += 1000));
    expect(r.drawOfferBy).toBeNull();
    draw(r, SAM.id, (t += 1000));
    draw(r, JOHN.id, (t += 1000));
    expect(r.result).toEqual({ outcome: 'agreed', winnerId: null });
    expect(toWire(r, JOHN.id, t).winnerIds).toEqual([]);
  });

  it('leaving a game in play forfeits it; leaving the lobby as host cancels', () => {
    const r = room();
    const t = playing(r, hostWhite);
    leave(r, SAM.id, t + 100);
    expect(r.result).toEqual({ outcome: 'left', winnerId: JOHN.id });
    expect(r.phase).toBe('finished');
    const lobby = room();
    leave(lobby, JOHN.id, T0);
    expect(lobby.phase).toBe('closed');
  });

  it('a player who leaves during the countdown hands the game to the other', () => {
    const r = room();
    join(r, SAM.id, T0);
    start(r, JOHN.id, T0);
    leave(r, SAM.id, T0 + 1000);
    advance(r, T0 + COUNTDOWN_MS, hostWhite);
    expect(r.phase).toBe('finished');
    expect(r.result).toEqual({ outcome: 'left', winnerId: JOHN.id });
  });
});

describe('play again', () => {
  it('swaps colours for the same two and starts a fresh board', () => {
    const r = room();
    let t = playing(r, hostWhite);
    expect(white(r).id).toBe(JOHN.id);
    move(r, JOHN.id, { from: 'e2', to: 'e4' }, (t += 1000));
    resign(r, SAM.id, (t += 1000));
    again(r, JOHN.id, (t += 1000));
    expect(r.phase).toBe('lobby');
    expect(r.moves).toEqual([]);
    expect(r.players.every((p) => !p.seated && p.colour === null)).toBe(true);
    start(r, JOHN.id, (t += 1000));
    advance(r, (t += COUNTDOWN_MS), hostWhite);
    expect(white(r).id).toBe(SAM.id);
    expect(black(r).id).toBe(JOHN.id);
    expect(toWire(r, SAM.id, t).legal.length).toBe(20);
    expect(toWire(r, SAM.id, t).fen).toMatch(/^rnbqkbnr/);
  });
});

describe('the wire', () => {
  it('carries the board, clocks, pieces taken and the move list, hiding nothing', () => {
    const r = room([SAM], 'easy');
    let t = playing(r, hostWhite);
    move(r, JOHN.id, { from: 'e2', to: 'e4' }, (t += 2000));
    const w = toWire(r, KIM.id, t);
    expect(w).toMatchObject({
      game: 'chess',
      phase: 'playing',
      mainMs: CLOCK.easy.mainMs,
      incrementMs: CLOCK.easy.incrementMs,
      turn: 'b',
      whiteId: JOHN.id,
      blackId: SAM.id,
      moves: ['e4'],
      check: false,
      drawOfferBy: null,
      result: null,
      standings: null,
      winnerIds: [],
    });
    expect(w.clocks.w).toBe(CLOCK.easy.mainMs - 2000 + CLOCK.easy.incrementMs);
    expect(w.clocks.b).toBe(CLOCK.easy.mainMs);
    expect(w.players.find((p) => p.id === JOHN.id)).toMatchObject({ seated: true, colour: 'w', isHost: true });
    expect(w.legal).toEqual([]);
  });

  it('marks a promotion among the legal moves once, not four times', () => {
    const r = room();
    const t = playing(r, hostWhite);
    r.position = fromFen('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    const w = toWire(r, JOHN.id, t);
    const up = w.legal.filter((m) => m.from === 'a7');
    expect(up).toEqual([{ from: 'a7', to: 'a8', promotes: true }]);
  });
});
