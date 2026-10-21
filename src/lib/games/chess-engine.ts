// Chess — the board, the pieces and the laws of the game, with no room, clock
// or player in sight. `chess.ts` is the family game built on this.
//
// Written here rather than taken from a package: the rules module pattern
// wants pure functions over plain data, and the whole thing is checked by
// perft counts against the standard positions (`chess-engine.test.ts`), which
// is a stronger guarantee than any hand-written test of one rule.
//
// Squares are 0–63, a1 = 0, h1 = 7, a8 = 56, h8 = 63 (index = rank * 8 + file).
// A position is immutable: `applyMove` returns a new one.

export type Colour = 'w' | 'b';
export type PieceKind = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export interface Piece {
  colour: Colour;
  kind: PieceKind;
}
/** 64 squares, a1 first. */
export type Board = (Piece | null)[];

export interface Castling {
  /** White may castle kingside / queenside; black likewise. */
  K: boolean;
  Q: boolean;
  k: boolean;
  q: boolean;
}

export interface Position {
  board: Board;
  turn: Colour;
  castling: Castling;
  /** The square a pawn just passed over with a double step, or null. */
  ep: number | null;
  /** Half-moves since the last capture or pawn move (the fifty-move rule). */
  halfmove: number;
  /** Starts at 1, counts up after black's move. */
  fullmove: number;
}

export interface Move {
  from: number;
  to: number;
  piece: PieceKind;
  /** What it takes — the pawn, for an en passant capture. */
  captured: PieceKind | null;
  promotion: Exclude<PieceKind, 'p' | 'k'> | null;
  castle: 'K' | 'Q' | null;
  ep: boolean;
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const FILES = 'abcdefgh';
export const PROMOTIONS = ['q', 'r', 'b', 'n'] as const;
export type Promotion = (typeof PROMOTIONS)[number];

export function other(colour: Colour): Colour {
  return colour === 'w' ? 'b' : 'w';
}

export function isPromotion(v: unknown): v is Promotion {
  return typeof v === 'string' && (PROMOTIONS as readonly string[]).includes(v);
}

/** "e4" for 28. */
export function squareName(sq: number): string {
  return FILES[sq & 7] + String((sq >> 3) + 1);
}

/** 28 for "e4"; null for anything that is not a square. */
export function squareIndex(name: unknown): number | null {
  if (typeof name !== 'string' || name.length !== 2) return null;
  const file = FILES.indexOf(name[0]);
  const rank = name.charCodeAt(1) - 49;
  if (file < 0 || rank < 0 || rank > 7) return null;
  return rank * 8 + file;
}

// ---- FEN -------------------------------------------------------------------

export function fromFen(fen: string): Position {
  const [placement = '', turn = 'w', castling = '-', ep = '-', half = '0', full = '1'] = fen.trim().split(/\s+/);
  const rows = placement.split('/');
  if (rows.length !== 8) throw new Error('A FEN has eight ranks.');
  const board: Board = Array.from({ length: 64 }, () => null);
  rows.forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        file += Number(ch);
        continue;
      }
      const kind = ch.toLowerCase();
      if (!'pnbrqk'.includes(kind) || file > 7) throw new Error(`Not a piece: ${ch}`);
      board[rank * 8 + file] = { colour: ch === kind ? 'b' : 'w', kind: kind as PieceKind };
      file++;
    }
    if (file !== 8) throw new Error('A rank has eight squares.');
  });
  return {
    board,
    turn: turn === 'b' ? 'b' : 'w',
    castling: { K: castling.includes('K'), Q: castling.includes('Q'), k: castling.includes('k'), q: castling.includes('q') },
    ep: ep === '-' ? null : squareIndex(ep),
    halfmove: Math.max(0, Number(half) || 0),
    fullmove: Math.max(1, Number(full) || 1),
  };
}

export function toFen(pos: Position): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = pos.board[rank * 8 + file];
      if (!p) {
        empty++;
        continue;
      }
      if (empty) {
        row += String(empty);
        empty = 0;
      }
      row += p.colour === 'w' ? p.kind.toUpperCase() : p.kind;
    }
    if (empty) row += String(empty);
    rows.push(row);
  }
  const c = pos.castling;
  const castling = `${c.K ? 'K' : ''}${c.Q ? 'Q' : ''}${c.k ? 'k' : ''}${c.q ? 'q' : ''}` || '-';
  return `${rows.join('/')} ${pos.turn} ${castling} ${pos.ep === null ? '-' : squareName(pos.ep)} ${pos.halfmove} ${pos.fullmove}`;
}

export function startPosition(): Position {
  return fromFen(START_FEN);
}

// ---- Attacks ---------------------------------------------------------------

const KNIGHT_STEPS = [
  [1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1],
] as const;
const KING_STEPS = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;
const BISHOP_RAYS = [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
const ROOK_RAYS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** The piece at (file, rank); `undefined` off the board, `null` for empty. */
function at(board: Board, file: number, rank: number): Piece | null | undefined {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return undefined;
  return board[rank * 8 + file];
}

/** Whether `by` attacks `sq` — a king may not step there, a castling may not pass it. */
export function attacked(board: Board, sq: number, by: Colour): boolean {
  const f = sq & 7;
  const r = sq >> 3;
  const pawnRank = by === 'w' ? r - 1 : r + 1;
  for (const df of [-1, 1]) {
    const p = at(board, f + df, pawnRank);
    if (p && p.colour === by && p.kind === 'p') return true;
  }
  for (const [df, dr] of KNIGHT_STEPS) {
    const p = at(board, f + df, r + dr);
    if (p && p.colour === by && p.kind === 'n') return true;
  }
  for (const [df, dr] of KING_STEPS) {
    const p = at(board, f + df, r + dr);
    if (p && p.colour === by && p.kind === 'k') return true;
  }
  for (const [df, dr] of BISHOP_RAYS) {
    for (let x = f + df, y = r + dr; ; x += df, y += dr) {
      const p = at(board, x, y);
      if (p === undefined) break;
      if (p) {
        if (p.colour === by && (p.kind === 'b' || p.kind === 'q')) return true;
        break;
      }
    }
  }
  for (const [df, dr] of ROOK_RAYS) {
    for (let x = f + df, y = r + dr; ; x += df, y += dr) {
      const p = at(board, x, y);
      if (p === undefined) break;
      if (p) {
        if (p.colour === by && (p.kind === 'r' || p.kind === 'q')) return true;
        break;
      }
    }
  }
  return false;
}

export function kingSquare(board: Board, colour: Colour): number {
  return board.findIndex((p) => p !== null && p.colour === colour && p.kind === 'k');
}

/** The side to move is in check. */
export function inCheck(pos: Position): boolean {
  const k = kingSquare(pos.board, pos.turn);
  return k >= 0 && attacked(pos.board, k, other(pos.turn));
}

// ---- Moves -----------------------------------------------------------------

function pseudoMoves(pos: Position): Move[] {
  const { board, turn } = pos;
  const enemy = other(turn);
  const out: Move[] = [];
  const add = (from: number, to: number, piece: PieceKind, captured: PieceKind | null, extra: Partial<Move> = {}) =>
    out.push({ from, to, piece, captured, promotion: null, castle: null, ep: false, ...extra });
  const pawnTo = (from: number, to: number, captured: PieceKind | null, lastRank: number) => {
    if (to >> 3 === lastRank) for (const promotion of PROMOTIONS) add(from, to, 'p', captured, { promotion });
    else add(from, to, 'p', captured);
  };
  const slide = (from: number, rays: readonly (readonly [number, number])[], piece: PieceKind) => {
    const f = from & 7;
    const r = from >> 3;
    for (const [df, dr] of rays) {
      for (let x = f + df, y = r + dr; ; x += df, y += dr) {
        const t = at(board, x, y);
        if (t === undefined) break;
        if (t) {
          if (t.colour === enemy) add(from, y * 8 + x, piece, t.kind);
          break;
        }
        add(from, y * 8 + x, piece, null);
      }
    }
  };

  for (let from = 0; from < 64; from++) {
    const p = board[from];
    if (!p || p.colour !== turn) continue;
    const f = from & 7;
    const r = from >> 3;
    switch (p.kind) {
      case 'p': {
        const dir = turn === 'w' ? 1 : -1;
        const home = turn === 'w' ? 1 : 6;
        const last = turn === 'w' ? 7 : 0;
        const r1 = r + dir;
        if (r1 < 0 || r1 > 7) break;
        if (!board[r1 * 8 + f]) {
          pawnTo(from, r1 * 8 + f, null, last);
          if (r === home && !board[(r + 2 * dir) * 8 + f]) add(from, (r + 2 * dir) * 8 + f, 'p', null);
        }
        for (const df of [-1, 1]) {
          const t = at(board, f + df, r1);
          if (t === undefined) continue;
          const to = r1 * 8 + f + df;
          if (t && t.colour === enemy) pawnTo(from, to, t.kind, last);
          else if (!t && to === pos.ep) add(from, to, 'p', 'p', { ep: true });
        }
        break;
      }
      case 'n':
        for (const [df, dr] of KNIGHT_STEPS) {
          const t = at(board, f + df, r + dr);
          if (t === undefined || (t && t.colour === turn)) continue;
          add(from, (r + dr) * 8 + f + df, 'n', t ? t.kind : null);
        }
        break;
      case 'b':
        slide(from, BISHOP_RAYS, 'b');
        break;
      case 'r':
        slide(from, ROOK_RAYS, 'r');
        break;
      case 'q':
        slide(from, BISHOP_RAYS, 'q');
        slide(from, ROOK_RAYS, 'q');
        break;
      case 'k': {
        for (const [df, dr] of KING_STEPS) {
          const t = at(board, f + df, r + dr);
          if (t === undefined || (t && t.colour === turn)) continue;
          add(from, (r + dr) * 8 + f + df, 'k', t ? t.kind : null);
        }
        const home = turn === 'w' ? 0 : 56;
        if (from !== home + 4) break;
        const rookAt = (sq: number) => board[sq]?.kind === 'r' && board[sq]?.colour === turn;
        const safe = (sq: number) => !attacked(board, sq, enemy);
        const kingside = turn === 'w' ? pos.castling.K : pos.castling.k;
        const queenside = turn === 'w' ? pos.castling.Q : pos.castling.q;
        if (kingside && !board[home + 5] && !board[home + 6] && rookAt(home + 7) && safe(home + 4) && safe(home + 5) && safe(home + 6)) {
          add(from, home + 6, 'k', null, { castle: 'K' });
        }
        if (
          queenside && !board[home + 3] && !board[home + 2] && !board[home + 1] && rookAt(home) &&
          safe(home + 4) && safe(home + 3) && safe(home + 2)
        ) {
          add(from, home + 2, 'k', null, { castle: 'Q' });
        }
        break;
      }
    }
  }
  return out;
}

/** The position after `m`, which must be one of `legalMoves(pos)`. */
export function applyMove(pos: Position, m: Move): Position {
  const board = pos.board.slice();
  const p = board[m.from];
  if (!p) throw new Error('No piece to move.');
  board[m.from] = null;
  if (m.ep) board[m.to + (pos.turn === 'w' ? -8 : 8)] = null;
  board[m.to] = m.promotion ? { colour: p.colour, kind: m.promotion } : p;
  const home = pos.turn === 'w' ? 0 : 56;
  if (m.castle === 'K') {
    board[home + 5] = board[home + 7];
    board[home + 7] = null;
  } else if (m.castle === 'Q') {
    board[home + 3] = board[home];
    board[home] = null;
  }
  const castling = { ...pos.castling };
  if (p.kind === 'k') {
    if (pos.turn === 'w') castling.K = castling.Q = false;
    else castling.k = castling.q = false;
  }
  // A rook that moves, or is taken, on its home square ends that castling.
  for (const sq of [m.from, m.to]) {
    if (sq === 0) castling.Q = false;
    else if (sq === 7) castling.K = false;
    else if (sq === 56) castling.q = false;
    else if (sq === 63) castling.k = false;
  }
  return {
    board,
    turn: other(pos.turn),
    castling,
    ep: p.kind === 'p' && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : null,
    halfmove: p.kind === 'p' || m.captured ? 0 : pos.halfmove + 1,
    fullmove: pos.turn === 'b' ? pos.fullmove + 1 : pos.fullmove,
  };
}

/** Every move the side to move may make. Empty is mate or stalemate. */
export function legalMoves(pos: Position): Move[] {
  return pseudoMoves(pos).filter((m) => {
    const next = applyMove(pos, m);
    const k = kingSquare(next.board, pos.turn);
    return k < 0 || !attacked(next.board, k, next.turn);
  });
}

/**
 * The legal move for a from/to pair, or why there is none: `'none'` (nothing
 * moves that way), `'promotion'` (it is a pawn reaching the last rank and no
 * piece was named).
 */
export function findMove(
  legal: readonly Move[],
  from: number,
  to: number,
  promotion: Promotion | null,
): Move | 'none' | 'promotion' {
  const matches = legal.filter((m) => m.from === from && m.to === to);
  if (!matches.length) return 'none';
  if (matches[0].promotion) return matches.find((m) => m.promotion === promotion) ?? 'promotion';
  return matches[0];
}

// ---- Notation --------------------------------------------------------------

/** Standard algebraic notation for `m` in `pos`: "Nf3", "exd5", "O-O", "e8=Q+", "Qh7#". */
export function san(pos: Position, m: Move, legal: readonly Move[] = legalMoves(pos)): string {
  let s: string;
  if (m.castle) {
    s = m.castle === 'K' ? 'O-O' : 'O-O-O';
  } else if (m.piece === 'p') {
    s = m.captured ? `${FILES[m.from & 7]}x${squareName(m.to)}` : squareName(m.to);
    if (m.promotion) s += `=${m.promotion.toUpperCase()}`;
  } else {
    s = m.piece.toUpperCase();
    // Another piece of the same kind could reach the same square: say which.
    const others = legal.filter((o) => o.to === m.to && o.from !== m.from && o.piece === m.piece);
    if (others.length) {
      const sameFile = others.some((o) => (o.from & 7) === (m.from & 7));
      const sameRank = others.some((o) => o.from >> 3 === m.from >> 3);
      if (!sameFile) s += FILES[m.from & 7];
      else if (!sameRank) s += String((m.from >> 3) + 1);
      else s += squareName(m.from);
    }
    if (m.captured) s += 'x';
    s += squareName(m.to);
  }
  const next = applyMove(pos, m);
  if (inCheck(next)) s += legalMoves(next).length ? '+' : '#';
  return s;
}

// ---- Endings ---------------------------------------------------------------

export type Ending = 'checkmate' | 'stalemate' | 'insufficient' | 'fifty-moves' | 'repetition';

/**
 * Neither side can ever mate: bare kings, a king and one minor piece, or
 * bishops only and all on squares of one colour.
 */
export function insufficientMaterial(board: Board): boolean {
  const pieces: { kind: PieceKind; dark: boolean }[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (!p || p.kind === 'k') continue;
    if (p.kind === 'p' || p.kind === 'r' || p.kind === 'q') return false;
    pieces.push({ kind: p.kind, dark: ((sq & 7) + (sq >> 3)) % 2 === 0 });
  }
  if (pieces.length <= 1) return true;
  return pieces.every((p) => p.kind === 'b') && pieces.every((p) => p.dark === pieces[0].dark);
}

/** Whether `colour` has anything that could ever give mate — a flag fall against it is a draw otherwise. */
export function canMate(board: Board, colour: Colour): boolean {
  const own = board.filter((p): p is Piece => p !== null && p.colour === colour && p.kind !== 'k');
  if (!own.length) return false;
  if (own.length === 1) return own[0].kind !== 'b' && own[0].kind !== 'n';
  return true;
}

/**
 * The position for the repetition rule: pieces, side to move, castling rights,
 * and an en passant capture only when one is actually possible.
 */
export function repetitionKey(pos: Position, legal: readonly Move[] = legalMoves(pos)): string {
  const [placement, turn, castling] = toFen(pos).split(' ');
  const ep = legal.some((m) => m.ep) ? squareName(pos.ep as number) : '-';
  return `${placement} ${turn} ${castling} ${ep}`;
}

/** How the game has ended in `pos`, or null while it goes on. `repetitions` counts this position's occurrences, this one included. */
export function ending(pos: Position, legal: readonly Move[], repetitions: number): Ending | null {
  if (!legal.length) return inCheck(pos) ? 'checkmate' : 'stalemate';
  if (insufficientMaterial(pos.board)) return 'insufficient';
  if (pos.halfmove >= 100) return 'fifty-moves';
  if (repetitions >= 3) return 'repetition';
  return null;
}

/** Leaf nodes at `depth` — the move generator's proof against the known counts. */
export function perft(pos: Position, depth: number): number {
  const legal = legalMoves(pos);
  if (depth <= 1) return legal.length;
  let n = 0;
  for (const m of legal) n += perft(applyMove(pos, m), depth - 1);
  return n;
}
