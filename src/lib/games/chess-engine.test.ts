import { describe, expect, it } from 'vitest';
import {
  START_FEN,
  applyMove,
  canMate,
  ending,
  findMove,
  fromFen,
  inCheck,
  insufficientMaterial,
  legalMoves,
  perft,
  repetitionKey,
  san,
  squareIndex,
  squareName,
  startPosition,
  toFen,
  type Position,
} from './chess-engine';

/** Play SAN-free moves by square pairs, failing loudly on an illegal one. */
function play(pos: Position, ...pairs: string[]): Position {
  for (const pair of pairs) {
    const [from, to, promotion] = pair.split(/[- =]/);
    const found = findMove(legalMoves(pos), squareIndex(from)!, squareIndex(to)!, (promotion?.toLowerCase() as 'q') ?? null);
    if (typeof found === 'string') throw new Error(`${pair}: ${found} in ${toFen(pos)}`);
    pos = applyMove(pos, found);
  }
  return pos;
}

describe('squares and FEN', () => {
  it('names squares a1 = 0 … h8 = 63', () => {
    expect(squareName(0)).toBe('a1');
    expect(squareName(7)).toBe('h1');
    expect(squareName(56)).toBe('a8');
    expect(squareName(63)).toBe('h8');
    expect(squareIndex('e4')).toBe(28);
    expect(squareIndex('i4')).toBeNull();
    expect(squareIndex('e9')).toBeNull();
    expect(squareIndex(4)).toBeNull();
  });

  it('round-trips the start position and a mid-game one', () => {
    expect(toFen(startPosition())).toBe(START_FEN);
    const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
    expect(toFen(fromFen(fen))).toBe(fen);
    const ep = 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3';
    expect(toFen(fromFen(ep))).toBe(ep);
  });

  it('refuses a malformed placement', () => {
    expect(() => fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1')).toThrow();
    expect(() => fromFen('rnbqkbnr/pppppppx/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toThrow();
  });
});

// The counts every move generator is checked against (chessprogramming.org/Perft_Results).
describe('perft', () => {
  it('start position: 20, 400, 8 902, 197 281', () => {
    const pos = startPosition();
    expect(perft(pos, 1)).toBe(20);
    expect(perft(pos, 2)).toBe(400);
    expect(perft(pos, 3)).toBe(8_902);
    expect(perft(pos, 4)).toBe(197_281);
  }, 30_000);

  it('Kiwipete (castling, en passant, promotions, checks): 48, 2 039, 97 862', () => {
    const pos = fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    expect(perft(pos, 1)).toBe(48);
    expect(perft(pos, 2)).toBe(2_039);
    expect(perft(pos, 3)).toBe(97_862);
  }, 30_000);

  it('position 3 (pins and en passant into check): 14, 191, 2 812, 43 238', () => {
    const pos = fromFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
    expect(perft(pos, 1)).toBe(14);
    expect(perft(pos, 2)).toBe(191);
    expect(perft(pos, 3)).toBe(2_812);
    expect(perft(pos, 4)).toBe(43_238);
  }, 30_000);

  it('position 4 (promotions with captures, castling through attack): 6, 264, 9 467', () => {
    const pos = fromFen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');
    expect(perft(pos, 1)).toBe(6);
    expect(perft(pos, 2)).toBe(264);
    expect(perft(pos, 3)).toBe(9_467);
  }, 30_000);

  it('position 5: 44, 1 486, 62 379', () => {
    const pos = fromFen('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8');
    expect(perft(pos, 1)).toBe(44);
    expect(perft(pos, 2)).toBe(1_486);
    expect(perft(pos, 3)).toBe(62_379);
  }, 30_000);

  it('position 6: 46, 2 079, 89 890', () => {
    const pos = fromFen('r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10');
    expect(perft(pos, 1)).toBe(46);
    expect(perft(pos, 2)).toBe(2_079);
    expect(perft(pos, 3)).toBe(89_890);
  }, 30_000);
});

describe('the laws', () => {
  it('castles both ways, moving the rook, and loses the right once the king moves', () => {
    let pos = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const kingside = findMove(legalMoves(pos), squareIndex('e1')!, squareIndex('g1')!, null);
    expect(kingside).toMatchObject({ castle: 'K' });
    pos = applyMove(pos, kingside as never);
    expect(toFen(pos)).toBe('r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1');
    const queenside = findMove(legalMoves(pos), squareIndex('e8')!, squareIndex('c8')!, null);
    expect(queenside).toMatchObject({ castle: 'Q' });
    pos = applyMove(pos, queenside as never);
    expect(toFen(pos)).toBe('2kr3r/8/8/8/8/8/8/R4RK1 w - - 2 2');
  });

  it('refuses to castle out of, through or into check', () => {
    // A black rook on e8 gives check: no castling at all.
    expect(legalMoves(fromFen('4r3/8/8/8/8/8/8/R3K2R w KQ - 0 1')).filter((m) => m.castle)).toHaveLength(0);
    // A rook on f8 covers f1: kingside is out, queenside stands.
    const through = legalMoves(fromFen('5r2/8/8/8/8/8/8/R3K2R w KQ - 0 1')).filter((m) => m.castle);
    expect(through.map((m) => m.castle)).toEqual(['Q']);
    // A rook on b8 covers b1, which the king does not cross: queenside still stands.
    const b1 = legalMoves(fromFen('1r6/8/8/8/8/8/8/R3K2R w KQ - 0 1')).filter((m) => m.castle);
    expect(b1.map((m) => m.castle).sort()).toEqual(['K', 'Q']);
  });

  it('captures en passant, and only on the move after the double step', () => {
    let pos = play(startPosition(), 'e2-e4', 'a7-a6', 'e4-e5', 'd7-d5');
    expect(pos.ep).toBe(squareIndex('d6'));
    const ep = findMove(legalMoves(pos), squareIndex('e5')!, squareIndex('d6')!, null);
    expect(ep).toMatchObject({ ep: true, captured: 'p' });
    const taken = applyMove(pos, ep as never);
    expect(taken.board[squareIndex('d5')!]).toBeNull();
    // Waiting a move loses it.
    pos = play(pos, 'h2-h3', 'h7-h6');
    expect(findMove(legalMoves(pos), squareIndex('e5')!, squareIndex('d6')!, null)).toBe('none');
  });

  it('promotes, and insists on being told what to', () => {
    const pos = fromFen('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    const legal = legalMoves(pos);
    expect(findMove(legal, squareIndex('a7')!, squareIndex('a8')!, null)).toBe('promotion');
    const queen = findMove(legal, squareIndex('a7')!, squareIndex('a8')!, 'q');
    expect(queen).toMatchObject({ promotion: 'q' });
    expect(applyMove(pos, queen as never).board[squareIndex('a8')!]).toEqual({ colour: 'w', kind: 'q' });
    expect(findMove(legal, squareIndex('a7')!, squareIndex('a8')!, 'n')).toMatchObject({ promotion: 'n' });
  });

  it('never lets a pinned piece expose the king', () => {
    // The knight on d2 is pinned to the king by the bishop on a5.
    const pos = fromFen('4k3/8/8/b7/8/8/3N4/4K3 w - - 0 1');
    expect(legalMoves(pos).filter((m) => m.from === squareIndex('d2'))).toHaveLength(0);
  });

  it('finds checkmate, stalemate and the quiet endings', () => {
    const mate = fromFen('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    expect(inCheck(mate)).toBe(true);
    expect(ending(mate, legalMoves(mate), 1)).toBe('checkmate');
    const stalemate = fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(ending(stalemate, legalMoves(stalemate), 1)).toBe('stalemate');
    const bare = fromFen('7k/8/6K1/8/8/8/8/8 w - - 0 1');
    expect(ending(bare, legalMoves(bare), 1)).toBe('insufficient');
    const fifty = fromFen('7k/8/6K1/8/8/8/8/R7 w - - 100 80');
    expect(ending(fifty, legalMoves(fifty), 1)).toBe('fifty-moves');
    const open = startPosition();
    expect(ending(open, legalMoves(open), 3)).toBe('repetition');
    expect(ending(open, legalMoves(open), 2)).toBeNull();
  });

  it('knows which material can still mate', () => {
    expect(insufficientMaterial(fromFen('7k/8/6K1/8/8/8/8/8 w - - 0 1').board)).toBe(true);
    expect(insufficientMaterial(fromFen('7k/8/6K1/8/8/8/8/5B2 w - - 0 1').board)).toBe(true);
    expect(insufficientMaterial(fromFen('7k/8/6K1/8/8/8/8/5N2 w - - 0 1').board)).toBe(true);
    // Two bishops on the same colour (c1, e3 are both dark) cannot mate; one on a light square can.
    expect(insufficientMaterial(fromFen('7k/8/6K1/8/8/4B3/8/2B5 w - - 0 1').board)).toBe(true);
    expect(insufficientMaterial(fromFen('7k/8/6K1/8/8/8/8/2B2B2 w - - 0 1').board)).toBe(false);
    expect(insufficientMaterial(fromFen('7k/8/6K1/8/8/8/8/7P w - - 0 1').board)).toBe(false);
    expect(canMate(fromFen('7k/8/6K1/8/8/8/8/5N2 w - - 0 1').board, 'w')).toBe(false);
    expect(canMate(fromFen('7k/8/6K1/8/8/8/8/5R2 w - - 0 1').board, 'w')).toBe(true);
    expect(canMate(fromFen('7k/8/6K1/8/8/8/8/5R2 w - - 0 1').board, 'b')).toBe(false);
  });

  it('keys a repetition by the position, side, rights and a live en passant only', () => {
    const a = startPosition();
    const b = play(a, 'g1-f3', 'g8-f6', 'f3-g1', 'f6-g8');
    expect(repetitionKey(b)).toBe(repetitionKey(a));
    // After a double step with no pawn to take it, the key ignores the ep square.
    const c = play(startPosition(), 'e2-e4');
    expect(c.ep).toBe(squareIndex('e3'));
    expect(repetitionKey(c)).toMatch(/ -$/);
    const d = play(startPosition(), 'e2-e4', 'a7-a6', 'e4-e5', 'd7-d5');
    expect(repetitionKey(d)).toMatch(/ d6$/);
  });
});

describe('notation', () => {
  it('writes pawn moves, captures, castling, promotion and mate', () => {
    let pos = startPosition();
    const legal = legalMoves(pos);
    const e4 = findMove(legal, squareIndex('e2')!, squareIndex('e4')!, null);
    expect(san(pos, e4 as never, legal)).toBe('e4');
    pos = play(pos, 'e2-e4', 'd7-d5');
    const exd5 = findMove(legalMoves(pos), squareIndex('e4')!, squareIndex('d5')!, null);
    expect(san(pos, exd5 as never)).toBe('exd5');

    const castle = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const oo = findMove(legalMoves(castle), squareIndex('e1')!, squareIndex('g1')!, null);
    expect(san(castle, oo as never)).toBe('O-O');
    const ooo = findMove(legalMoves(castle), squareIndex('e1')!, squareIndex('c1')!, null);
    expect(san(castle, ooo as never)).toBe('O-O-O');

    const promo = fromFen('7k/P7/8/8/8/8/8/K7 w - - 0 1');
    const q = findMove(legalMoves(promo), squareIndex('a7')!, squareIndex('a8')!, 'q');
    expect(san(promo, q as never)).toBe('a8=Q+');

    const fools = play(startPosition(), 'f2-f3', 'e7-e5', 'g2-g4');
    const mate = findMove(legalMoves(fools), squareIndex('d8')!, squareIndex('h4')!, null);
    expect(san(fools, mate as never)).toBe('Qh4#');
  });

  it('disambiguates by file, then rank, then both', () => {
    // Rooks on a1 and h1 can both reach d1: the file tells them apart.
    const rooks = fromFen('4k3/8/8/8/8/8/6K1/R6R w - - 0 1');
    const rad1 = findMove(legalMoves(rooks), squareIndex('a1')!, squareIndex('d1')!, null);
    expect(san(rooks, rad1 as never)).toBe('Rad1');
    // Rooks on a1 and a5 both reach a3: same file, so the rank tells them apart.
    const stack = fromFen('4k3/8/8/R7/8/8/8/R3K3 w - - 0 1');
    const r1a3 = findMove(legalMoves(stack), squareIndex('a1')!, squareIndex('a3')!, null);
    expect(san(stack, r1a3 as never)).toBe('R1a3');
    // Three queens reach d4: a1 shares a file with a4 and a rank with d1, so
    // it needs both; a4 is told from a1 by rank, d1 from a1 by file.
    const queens = fromFen('6k1/8/8/8/Q7/8/8/Q2Q3K w - - 0 1');
    const legal = legalMoves(queens);
    const to = squareIndex('d4')!;
    expect(san(queens, findMove(legal, squareIndex('a1')!, to, null) as never, legal)).toBe('Qa1d4');
    expect(san(queens, findMove(legal, squareIndex('a4')!, to, null) as never, legal)).toBe('Q4d4');
    expect(san(queens, findMove(legal, squareIndex('d1')!, to, null) as never, legal)).toBe('Qdd4');
  });
});
