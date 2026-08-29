// Who owns a cell.
//
// SERVER-ONLY (see rings.ts).
//
// The brief asks for "the person with the most, and most recent win". Those are
// two orderings and they disagree, so this collapses them into one monotone
// number:
//
//     score = sum over that person's events of  weight x exp(-age_days / 43.3)
//
// A 30-day half-life: 1.00 today, 0.85 at a week, 0.50 at a month, 0.06 at four
// months. Owner is the argmax, ties broken by the most recent event.
//
// The property that makes this the right shape rather than merely a convenient
// one is that EXPONENTIAL DECAY PRESERVES RATIOS. Every score on a cell shrinks
// by the same factor as time passes, so the argmax cannot change on its own: a
// cell only ever changes hands because somebody actually went there. That is
// John's "any shape geometry exists until it's been taken over by someone
// else", literally, and it means there is no expiry job, no cliff, and no
// nightly sweep that could silently repaint the map while nobody was walking.
// Stale ground still gets progressively cheaper to steal, which is the part a
// hard "never expires" rule would lose.
//
// Nesting is not implemented anywhere. It falls out: Katie's block walks write
// events on exactly the cells her rings enclose, her fresher denser score
// out-ranks John's month-old single big-loop event on those cells, and the hole
// punches through while he keeps everything around it.

import { tileKeyOf, type Tile } from './tiles';

/** Decay constant, days. tau = 30 / ln 2, i.e. a 30-day half-life. */
export const DECAY_TAU_DAYS = 43.3;

export const LOOP_WEIGHT = 3;
export const TRAMPLE_WEIGHT = 1;

export type CaptureKind = 'loop' | 'trample';

export interface CaptureEvent {
  subject: string;
  tileX: number;
  tileY: number;
  /** UTC calendar day. Part of the uniqueness key, so it is stored rather than
   *  derived at read time from a timestamp in whichever zone asked. */
  day: string;
  kind: CaptureKind;
  weight: number;
  capturedAt: Date;
}

export interface TileOwnership {
  tileX: number;
  tileY: number;
  owner: string;
  score: number;
  runnerUp: string | null;
  runnerUpScore: number;
  /** Most recent event on this cell, by anyone. */
  lastEventAt: Date;
  /** When the current owner took it — the longest-held leaderboard's column. */
  ownerSince: Date;
}

const MS_PER_DAY = 86_400_000;

/**
 * Scores this close together are a tie, not a win — RELATIVE, never absolute.
 *
 * An absolute epsilon quietly destroys the one property the whole scheme rests
 * on. Ten years after a cell's last visit every score on it is around 1e-39, so
 * an absolute 1e-12 declares a three-to-one lead a dead heat and hands the cell
 * to whoever happened to walk it last — a flip with no visit behind it, which
 * is precisely what "ownership decays but never turns over on its own" forbids.
 * A relative comparison is scale-free, so the ratio decides at any age.
 */
const SCORE_EPSILON = 1e-12;

function isTie(a: number, b: number): boolean {
  return Math.abs(a - b) <= SCORE_EPSILON * Math.max(Math.abs(a), Math.abs(b));
}

/** UTC calendar day of an instant, `YYYY-MM-DD`. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * exp(-age / tau), clamped at 1 for anything not yet in the past.
 *
 * A future timestamp is a clock fault, not a bonus: without the clamp a fix
 * stamped a day ahead would outscore a real visit.
 */
export function decayFactor(ageDays: number, tau = DECAY_TAU_DAYS): number {
  if (!(ageDays > 0)) return 1;
  return Math.exp(-ageDays / tau);
}

/** Build one loop or trample event per cell. */
export function captureEvents(
  subject: string,
  tiles: Tile[],
  capturedAt: Date,
  kind: CaptureKind = 'loop',
  weight = kind === 'loop' ? LOOP_WEIGHT : TRAMPLE_WEIGHT,
): CaptureEvent[] {
  const day = utcDay(capturedAt);
  return tiles.map((t) => ({
    subject,
    tileX: t.x,
    tileY: t.y,
    day,
    kind,
    weight,
    capturedAt,
  }));
}

const uniqueKey = (e: CaptureEvent) => `${e.subject} ${e.tileX} ${e.tileY} ${e.day} ${e.kind}`;

/**
 * At most one event per (person, cell, UTC day, kind), keeping the highest
 * weight and, at equal weight, the EARLIEST.
 *
 * Ten laps of the same garden loop in one afternoon score once. Without this
 * the game is over by teatime on day one.
 *
 * Earliest rather than latest because this is not a display rule: it is the
 * same uniqueIndex the ledger table carries, and an append-only ledger inserting
 * ON CONFLICT DO NOTHING keeps the row that got there first. If this kept the
 * latest, a rebuild would score a ten-lap day fractionally higher than the live
 * ingest did — a discrepancy of a few hours of decay that nobody would ever
 * trace, and it would appear only on days somebody went round twice.
 *
 * Weight is a pure function of `kind` today, so the weight comparison can only
 * matter if a future kind ever carries a variable weight. It is kept because
 * being wrong in that direction loses a capture, and costs nothing now.
 */
export function dedupeEvents(events: CaptureEvent[]): CaptureEvent[] {
  const best = new Map<string, CaptureEvent>();
  for (const e of events) {
    const key = uniqueKey(e);
    const held = best.get(key);
    if (
      !held ||
      e.weight > held.weight ||
      (e.weight === held.weight && e.capturedAt.getTime() < held.capturedAt.getTime())
    ) {
      best.set(key, e);
    }
  }
  return [...best.values()];
}

interface Standing {
  subject: string;
  score: number;
  /** Most recent event by this subject, for the tie-break. */
  lastAt: number;
}

/** Decayed score per subject over the events that had happened by `atMs`. */
function standingsAt(ordered: CaptureEvent[], atMs: number): Standing[] {
  const scores = new Map<string, Standing>();
  for (const e of ordered) {
    const t = e.capturedAt.getTime();
    if (t > atMs) break;
    const held = scores.get(e.subject) ?? { subject: e.subject, score: 0, lastAt: t };
    held.score += e.weight * decayFactor((atMs - t) / MS_PER_DAY);
    held.lastAt = Math.max(held.lastAt, t);
    scores.set(e.subject, held);
  }

  // Highest score wins; equal scores go to the most recent event; a dead-level
  // tie falls back to the subject name, so the answer never depends on the
  // order rows happened to come out of the database.
  return [...scores.values()].sort((a, b) => {
    if (!isTie(a.score, b.score)) return b.score - a.score;
    if (a.lastAt !== b.lastAt) return b.lastAt - a.lastAt;
    return a.subject < b.subject ? -1 : 1;
  });
}

/**
 * Owner of every cell any of these events touched, AS AT `now`.
 *
 * Events are replayed in time order rather than summed once, because
 * `ownerSince` has to answer "how long have you held this", not "when did you
 * first set foot here". Replay is cheap — the ledger only grows by the cells
 * somebody actually walked — and it is the only way to get the handover moment
 * right on a cell that has changed hands more than once.
 *
 * `now` IS THE HORIZON, NOT A DEFAULT. Everything after it is invisible: the
 * replay stops there, `lastEventAt` comes from the same bounded slice, and a
 * cell with nothing at or before `now` is simply absent from the result rather
 * than reported as owned by nobody.
 *
 * Two callers make that a correctness requirement rather than tidiness.
 *
 *  - `geo_daily_snapshot` exists precisely so the weekly gained/lost board never
 *    replays a decayed ledger. Writing it means asking "who owned what last
 *    Sunday" over a ledger that already holds this week's events — an as-of
 *    query with `now` in the past by construction. Unbounded, the replay ran
 *    past `now` and returned an `ownerSince` LATER than the owner it reported,
 *    which the longest-held board reads as a negative hold.
 *  - A Life360 or Home Assistant fix carries the DEVICE clock. One family phone
 *    a minute fast stamps an event in the future. `decayFactor` already clamps
 *    those — the module has always expected them — but `standingsAt` stops at
 *    the horizon, so an unguarded `final[0]` on such a cell threw, and the throw
 *    escaped the whole loop: one skewed fix on one cell aborted ownership for
 *    every cell in the hourly run.
 */
export function resolveOwnership(
  events: CaptureEvent[],
  now: Date = new Date(),
): Map<string, TileOwnership> {
  const nowMs = now.getTime();

  const byTile = new Map<string, CaptureEvent[]>();
  for (const e of dedupeEvents(events)) {
    const key = tileKeyOf(e.tileX, e.tileY);
    const list = byTile.get(key);
    if (list) list.push(e);
    else byTile.set(key, [e]);
  }

  const out = new Map<string, TileOwnership>();

  for (const [key, list] of byTile) {
    const ordered = [...list]
      .filter((e) => e.capturedAt.getTime() <= nowMs)
      .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());

    // Nothing had happened here yet. Not "owned by nobody" — not a row at all.
    if (!ordered.length) continue;

    let owner: string | null = null;
    let ownerSince = ordered[0].capturedAt;

    for (const e of ordered) {
      // The leader as at each event. Because the decay preserves ratios, the
      // leader at an event is still the leader at every later instant until
      // the next event, so these are the only moments ownership can change.
      const leader = standingsAt(ordered, e.capturedAt.getTime())[0];
      if (leader && leader.subject !== owner) {
        owner = leader.subject;
        ownerSince = e.capturedAt;
      }
    }

    const final = standingsAt(ordered, nowMs);
    if (!final.length) continue;

    out.set(key, {
      tileX: ordered[0].tileX,
      tileY: ordered[0].tileY,
      owner: final[0].subject,
      score: final[0].score,
      runnerUp: final[1]?.subject ?? null,
      runnerUpScore: final[1]?.score ?? 0,
      lastEventAt: ordered[ordered.length - 1].capturedAt,
      ownerSince,
    });
  }

  return out;
}
