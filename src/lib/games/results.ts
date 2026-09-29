// The games leaderboard — the pure half. What a finished round records, the
// family's day and week (Europe/London, whatever the server's clock), and the
// boards built from the recorded rows.
//
// The recorder asks nothing new of a game: it reads the game's own finished
// wire (`standings` + `winnerIds`, which every game already sends its phones),
// so a new game records correctly without a line here. A standing's `score` is
// the high score when it is a number; a game whose standings have none (Liar's
// Dice: an elimination order) records null and ranks by wins. A game whose
// best-of number is called something else says so with `GameRules.resultScore`.

import type { GameId, GameRules, RoomBase } from './catalogue';

export const FAMILY_TZ = 'Europe/London';

export const WINDOWS = ['day', 'week', 'all'] as const;
export type Window = (typeof WINDOWS)[number];

export function isWindow(value: unknown): value is Window {
  return typeof value === 'string' && (WINDOWS as readonly string[]).includes(value);
}

/** One contender's result in one finished round — a `game_results` row. */
export interface RoundRow {
  game: GameId;
  roomId: string;
  round: number;
  playerId: string;
  playerName: string;
  score: number | null;
  rank: number;
  won: boolean;
  players: number;
  difficulty: string;
  options: Record<string, string | number | boolean>;
  finishedAt: Date;
}

interface WireStanding {
  id: string;
  name: string;
  score?: unknown;
  [key: string]: unknown;
}

const isScore = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The host's choices that changed what the round could reach, as the room
 * actually used them: each key the create request carried that the room holds
 * as a plain value (Boggle's `size`, `seconds`, `scoring`), plus the game's own
 * one-line `about` as `label`. Free text longer than a label is dropped.
 */
export function roundOptions(
  room: RoomBase,
  rules: Pick<GameRules, 'about'>,
  optionKeys: readonly string[],
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const fields = room as unknown as Record<string, unknown>;
  for (const key of optionKeys) {
    const v = fields[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'boolean') out[key] = v;
    else if (typeof v === 'string' && v.length <= 80) out[key] = v;
  }
  let label: string | null = null;
  try {
    label = rules.about?.(room) ?? null;
  } catch {
    label = null;
  }
  if (label) out.label = label.slice(0, 120);
  return out;
}

/**
 * The rows a finished room records for `round`, from its own finished wire.
 * Empty when the room is not finished or its wire carries no standings.
 *
 * Rank follows the game's own order: the winners share 1, a tie on score
 * shares the place above it, everyone else is their position. A solo round is
 * recorded (it counts for high scores) and nobody wins it, as the games say.
 */
export function roundRows(
  room: RoomBase,
  rules: Pick<GameRules, 'toWire' | 'about' | 'resultScore'>,
  round: number,
  now: number,
  optionKeys: readonly string[] = [],
): RoundRow[] {
  if (room.phase !== 'finished') return [];
  const wire = rules.toWire(room, room.hostId, now) as unknown as {
    standings?: WireStanding[] | null;
    winnerIds?: string[] | null;
  };
  const standings = Array.isArray(wire.standings) ? wire.standings : [];
  if (!standings.length) return [];
  const winners = new Set(standings.length > 1 && Array.isArray(wire.winnerIds) ? wire.winnerIds : []);
  const options = roundOptions(room, rules, optionKeys);
  const scoreOf = (s: WireStanding): number | null => {
    const v = rules.resultScore ? rules.resultScore(s) : s.score;
    return isScore(v) ? Math.round(v) : null;
  };
  const finishedAt = new Date(now);
  const rows: RoundRow[] = [];
  standings.forEach((s, i) => {
    const score = scoreOf(s);
    const won = winners.has(s.id);
    const prev = rows[i - 1];
    const rank = won
      ? 1
      : prev && score !== null && prev.score === score
        ? prev.rank
        : i + 1;
    rows.push({
      game: room.game,
      roomId: room.id,
      round,
      playerId: s.id,
      playerName: String(s.name ?? '').slice(0, 80) || 'Someone',
      score,
      rank,
      won,
      players: standings.length,
      difficulty: room.difficulty,
      options,
      finishedAt,
    });
  });
  return rows;
}

// ── The family's clock ──────────────────────────────────────────────────────

function offsetMs(at: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: FAMILY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(at));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
  return wall - Math.floor(at / 1000) * 1000;
}

/** The London calendar date an instant falls on, as [y, m (1-12), d]. */
function londonDate(at: number): [number, number, number] {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: FAMILY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
  const [y, m, d] = s.split('-').map(Number);
  return [y, m, d];
}

/**
 * The instant London's midnight began on a calendar date. The clocks change at
 * 01:00 UTC, never at midnight, so every London midnight exists exactly once;
 * the guess is corrected by the offset in force at the guess itself.
 */
function londonMidnight(y: number, m: number, d: number): number {
  const wall = Date.UTC(y, m - 1, d);
  const guess = wall - offsetMs(wall);
  return wall - offsetMs(guess);
}

/**
 * When a window began: today = London midnight, this week = London midnight
 * on the Monday, all time = null. Correct across both clock changes, on a
 * server whose own clock is UTC.
 */
export function windowStart(window: Window, now: number): Date | null {
  if (window === 'all') return null;
  const [y, m, d] = londonDate(now);
  if (window === 'day') return new Date(londonMidnight(y, m, d));
  // Calendar arithmetic on the date, not 24 h steps, so a clock change inside
  // the week cannot shift the Monday.
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const back = (weekday + 6) % 7;
  const monday = new Date(Date.UTC(y, m - 1, d - back));
  return new Date(londonMidnight(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate()));
}

// ── Records ─────────────────────────────────────────────────────────────────

/**
 * Who in a round set a new family high score, and in the widest window they
 * set it: `all` beats `week` beats `day`. A record needs something to beat —
 * the first score of the day is not news — and only the round's top score can
 * be one. `before` is the best score in each window from every OTHER round.
 */
export function newRecords(
  rows: readonly Pick<RoundRow, 'playerId' | 'score'>[],
  before: Record<Window, number | null>,
): Record<string, Window> {
  const scored = rows.filter((r): r is typeof r & { score: number } => r.score !== null && r.score > 0);
  if (!scored.length) return {};
  const top = Math.max(...scored.map((r) => r.score));
  let widest: Window | null = null;
  for (const w of ['day', 'week', 'all'] as const) {
    const prev = before[w];
    if (prev !== null && top > prev) widest = w;
  }
  if (!widest) return {};
  const out: Record<string, Window> = {};
  for (const r of scored) if (r.score === top) out[r.playerId] = widest;
  return out;
}

// ── Boards ──────────────────────────────────────────────────────────────────

export interface BoardRow {
  rank: number;
  playerId: string;
  name: string;
  /** The best score in the window; null for a game with no numeric score. */
  best: number | null;
  /** What the best score was set on ("5×5 · 90 seconds · hard"); null if nothing to say. */
  bestLabel: string | null;
  wins: number;
  played: number;
}

export interface GameBoard {
  game: GameId;
  title: string;
  /** False for a game with no numeric score: it has no best column and ranks by wins. */
  scored: boolean;
  rows: BoardRow[];
}

export interface OverallRow {
  rank: number;
  playerId: string;
  name: string;
  wins: number;
  played: number;
}

export interface Leaderboard {
  window: Window;
  /** When the window began (ISO), null for all time. */
  from: string | null;
  overall: OverallRow[];
  games: GameBoard[];
}

type Stored = Pick<RoundRow, 'game' | 'playerId' | 'playerName' | 'score' | 'won' | 'difficulty' | 'options' | 'finishedAt'>;

const LEVEL: Record<string, string> = { easy: 'easy', medium: 'medium', hard: 'hard' };

function labelOf(r: Stored): string | null {
  const bits = [typeof r.options?.label === 'string' ? r.options.label : null, LEVEL[r.difficulty] ?? null].filter(
    (x): x is string => !!x,
  );
  return bits.length ? bits.join(' · ') : null;
}

/** Competition ranking: equal keys share the place, the next place skips. */
function ranked<T>(list: T[], same: (a: T, b: T) => boolean): Array<T & { rank: number }> {
  const out: Array<T & { rank: number }> = [];
  list.forEach((x, i) => {
    const prev = out[i - 1];
    out.push({ ...x, rank: prev && same(prev, x) ? prev.rank : i + 1 });
  });
  return out;
}

/**
 * The boards for one window, from its recorded rows. A person's name is the
 * one on their latest row. Games come in `order` (the catalogue's), and only
 * games somebody has played in the window appear.
 */
export function buildLeaderboard(
  rows: readonly Stored[],
  window: Window,
  from: Date | null,
  order: readonly GameId[],
  titles: Partial<Record<GameId, string>>,
): Leaderboard {
  const latestName = new Map<string, { at: number; name: string }>();
  for (const r of rows) {
    const at = r.finishedAt.getTime();
    const seen = latestName.get(r.playerId);
    if (!seen || at >= seen.at) latestName.set(r.playerId, { at, name: r.playerName });
  }
  const nameOf = (id: string) => latestName.get(id)?.name ?? 'Someone';

  type Acc = { playerId: string; best: number | null; bestAt: number; bestRow: Stored | null; wins: number; played: number };
  const perGame = new Map<string, Map<string, Acc>>();
  const overall = new Map<string, { wins: number; played: number }>();
  for (const r of rows) {
    const byPlayer = perGame.get(r.game) ?? new Map<string, Acc>();
    perGame.set(r.game, byPlayer);
    const acc = byPlayer.get(r.playerId) ?? { playerId: r.playerId, best: null, bestAt: Infinity, bestRow: null, wins: 0, played: 0 };
    byPlayer.set(r.playerId, acc);
    acc.played += 1;
    if (r.won) acc.wins += 1;
    const at = r.finishedAt.getTime();
    // The best, and on a tie the one set FIRST: whoever got there first holds it.
    if (r.score !== null && (acc.best === null || r.score > acc.best || (r.score === acc.best && at < acc.bestAt))) {
      acc.best = r.score;
      acc.bestAt = at;
      acc.bestRow = r;
    }
    const o = overall.get(r.playerId) ?? { wins: 0, played: 0 };
    o.played += 1;
    if (r.won) o.wins += 1;
    overall.set(r.playerId, o);
  }

  const known = new Set<string>(order);
  const games: GameBoard[] = [];
  for (const game of [...order, ...[...perGame.keys()].filter((g) => !known.has(g)).sort()] as GameId[]) {
    const byPlayer = perGame.get(game);
    if (!byPlayer) continue;
    const list = [...byPlayer.values()];
    const scored = list.some((a) => a.best !== null);
    list.sort((a, b) =>
      scored
        ? (b.best ?? -Infinity) - (a.best ?? -Infinity) || a.bestAt - b.bestAt || b.wins - a.wins || a.played - b.played
        : b.wins - a.wins || a.played - b.played,
    );
    const withRank = ranked(list, (a, b) =>
      scored ? a.best === b.best && a.bestAt === b.bestAt : a.wins === b.wins && a.played === b.played,
    );
    games.push({
      game,
      title: titles[game] ?? game,
      scored,
      rows: withRank.map((a) => ({
        rank: a.rank,
        playerId: a.playerId,
        name: nameOf(a.playerId),
        best: a.best,
        bestLabel: a.bestRow ? labelOf(a.bestRow) : null,
        wins: a.wins,
        played: a.played,
      })),
    });
  }

  const people = [...overall.entries()]
    .map(([playerId, o]) => ({ playerId, name: nameOf(playerId), wins: o.wins, played: o.played }))
    .sort((a, b) => b.wins - a.wins || a.played - b.played || a.name.localeCompare(b.name));
  const overallRows = ranked(people, (a, b) => a.wins === b.wins && a.played === b.played);

  return { window, from: from ? from.toISOString() : null, overall: overallRows, games };
}
