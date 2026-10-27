// Games played with no internet, filed later — the pure half of
// `POST /api/native/games/offline-results`.
//
// The phone (SRAppleApp `OfflineResultUpload`) queues one row per finished
// match it played and sends them in batches: `{ results: [...] }`, each row
//   { id, game: 'offline:<slug>', source: 'offline', title, mode: 'solo' | 'nearby',
//     finishedAt (epoch ms), players, bots, rank, score, won, detail?, opponents[] }
// (`opponents` is read past: see `parseOfflineResult`)
// and settles whatever comes back in `{ recorded: [id], rejected: [id] }`;
// an id in neither list is sent again later. A phone vouches only for its
// own result, so each row becomes ONE `game_results` row for the caller,
// keyed `offline-<id>` + round 1 + their player id: a retry, or the same
// match told by another phone, lands once per person (the table's unique key).
//
// Validation is strict about what would make a row wrong (the game id, the
// numbers, the time) and forgiving about the rest (a title, a detail, names):
// a bad row is `rejected` so the phone stops sending it, a good row in the
// same batch is still recorded. The game id is namespaced so an offline game
// that shares a name with an online one (Maths Sprint scores differently
// offline) never lands on the online board; any safe slug is accepted, so a
// new offline game — or the physics games, later — needs no change here.

/** The prefix every offline game id carries on the wire and in `game_results.game`. */
export const OFFLINE_GAME_PREFIX = 'offline:';
/** `game_results.room_id` for an offline match: never the shape of an online room id. */
export const OFFLINE_ROOM_PREFIX = 'offline-';
/** Rows read from one request; the phone sends 25. Rows past this are left unanswered and come again. */
export const OFFLINE_BATCH_MAX = 100;

/** `blackjack`, `maths-sprint`, `car-race`: lower-case words joined by single hyphens. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX = 48;
/** The match key: the room's key (8 hex, or the host's UUID) and the match number. */
const MATCH_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
/** An id echoed back in `rejected` must be the phone's own string, and not an essay. */
const ECHO_MAX = 200;
/** Seats at an offline table, computer players included: the room holds 5 phones, solo games add bots. */
const SEATS_MAX = 16;
/** Comfortably inside `game_results.score` (int4). */
const SCORE_MAX = 1_000_000_000;
/** Offline play shipped in 2026: an earlier time is a phone whose clock was reset. */
const EARLIEST = Date.parse('2026-01-01T00:00:00Z');

export type OfflineMode = 'solo' | 'nearby';

/** One result the caller can file: everything `game_results` needs but who they are. */
export interface OfflineRow {
  /** The phone's match id, exactly as sent — what `recorded` echoes. */
  id: string;
  /** `offline:<slug>`. */
  game: string;
  /** `offline-<id>`. */
  roomId: string;
  score: number;
  rank: number;
  /**
   * First with another PERSON to beat. The phone counts a win over computer
   * players; the family board does not, as a site game played alone wins
   * nothing — so a child beating three bots fifty times cannot top it.
   */
  won: boolean;
  players: number;
  options: Record<string, string | number | boolean>;
  finishedAt: Date;
}

export interface OfflineBatch {
  rows: OfflineRow[];
  /** Ids the phone should stop sending: malformed, or a game id that is not a safe slug. */
  rejected: string[];
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** Free text squeezed to one short line, or null. */
function line(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

/** The slug of an `offline:<slug>` game id, or null. */
export function offlineSlug(game: unknown): string | null {
  if (typeof game !== 'string' || !game.startsWith(OFFLINE_GAME_PREFIX)) return null;
  const slug = game.slice(OFFLINE_GAME_PREFIX.length);
  return slug.length <= SLUG_MAX && SLUG.test(slug) ? slug : null;
}

export function isOfflineGame(game: string): boolean {
  return offlineSlug(game) !== null;
}

/** "maths-sprint" → "Maths sprint": the title when a row carried none. */
function titleFromSlug(slug: string): string {
  const words = slug.replace(/-/g, ' ');
  return words[0].toUpperCase() + words.slice(1);
}

/**
 * The board title for an offline game: the phone's own title (the latest
 * row's `options.title`), else the slug, marked as offline so it reads apart
 * from an online game of the same name.
 */
export function offlineBoardTitle(game: string, title: unknown): string {
  const slug = offlineSlug(game) ?? game.slice(OFFLINE_GAME_PREFIX.length);
  return `${line(title, 60) ?? titleFromSlug(slug || 'game')} (offline)`;
}

/**
 * One wire row → a row to file, or a reason it is refused. `now` caps a time
 * from a phone whose clock runs fast: a result cannot finish in the future.
 */
export function parseOfflineResult(raw: unknown, now: number): { ok: true; row: OfflineRow } | { ok: false } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };
  const r = raw as Record<string, unknown>;
  const id = r.id;
  if (typeof id !== 'string' || !MATCH_ID.test(id)) return { ok: false };
  const slug = offlineSlug(r.game);
  if (!slug) return { ok: false };
  // The phone always says `offline`; absent is forgiven, anything else is not ours.
  if (r.source !== undefined && r.source !== 'offline') return { ok: false };

  const { players, rank, score } = r;
  const bots = r.bots === undefined ? 0 : r.bots;
  if (!isInt(players) || players < 1 || players > SEATS_MAX) return { ok: false };
  if (!isInt(bots) || bots < 0 || bots > players - 1) return { ok: false };
  if (!isInt(rank) || rank < 1 || rank > players) return { ok: false };
  if (typeof score !== 'number' || !Number.isFinite(score) || Math.abs(score) > SCORE_MAX) return { ok: false };
  if (typeof r.won !== 'boolean') return { ok: false };
  const at = r.finishedAt;
  if (typeof at !== 'number' || !Number.isFinite(at) || at < EARLIEST) return { ok: false };

  const humans = players - bots;
  const options: Record<string, string | number | boolean> = { source: 'offline', bots };
  const mode = r.mode === 'solo' || r.mode === 'nearby' ? (r.mode as OfflineMode) : null;
  if (mode) options.mode = mode;
  const title = line(r.title, 60);
  if (title) options.title = title;
  // The game's own detail ("best 212 ms · 1 false start") is what the board
  // shows beside a best, as an online round's `label` is.
  const detail = line(r.detail, 120);
  if (detail) options.label = detail;
  // `opponents` (the others' names) is not kept: the board does not need it,
  // and a name in somebody else's row would outlive that person's erasure
  // (`$lib/people/erase` deletes by player id).

  return {
    ok: true,
    row: {
      id,
      game: OFFLINE_GAME_PREFIX + slug,
      roomId: OFFLINE_ROOM_PREFIX + id,
      score: Math.round(score),
      rank,
      won: r.won && rank === 1 && humans >= 2,
      players,
      options,
      finishedAt: new Date(Math.min(at, now)),
    },
  };
}

/**
 * A request's `results` → the rows to file and the ids refused. The first
 * {@link OFFLINE_BATCH_MAX} entries are read; a repeated id is read once (the
 * first). A refused entry whose id is no string cannot be named back, so it
 * is dropped — the phone never sends one.
 */
export function parseOfflineBatch(results: readonly unknown[], now: number): OfflineBatch {
  const rows: OfflineRow[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const raw of results.slice(0, OFFLINE_BATCH_MAX)) {
    const id = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).id : undefined;
    if (typeof id === 'string') {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    const parsed = parseOfflineResult(raw, now);
    if (parsed.ok) rows.push(parsed.row);
    else if (typeof id === 'string' && id.length > 0 && id.length <= ECHO_MAX) rejected.push(id);
  }
  return { rows, rejected };
}
