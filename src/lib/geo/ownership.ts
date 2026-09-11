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

/**
 * Interior fill scores as a loop, because it IS one.
 *
 * A cell awarded by $lib/geo/fill is ground the outside could not reach without
 * crossing cells the person occupied — that is the definition of enclosure the
 * whole game is scored on, and it is a stronger demonstration than a polyline
 * whose two ends happened to land within 60 m of each other. Paying it less
 * than a loop would mean the 82% of real tracks that do not close geometrically
 * are worth a third of the 18% that do, for identical ground.
 *
 * Its own constant rather than an alias, so it can be retuned without touching
 * what a ring is worth.
 */
export const FILL_WEIGHT = LOOP_WEIGHT;

/**
 * One outing, one claim — however far it went.
 *
 * Each event's weight is divided by the number of events its OUTING produced,
 * raised to this power. At 0 the scheme is the original one, where a claim is
 * proportional to ground covered; at 1 an outing's total claim is the same
 * whether it painted three cells or six hundred, and it is simply spread more
 * thinly over the longer one.
 *
 * Measured on the real ledger (2026-09-11), over the 2,504 cells that more than
 * one person has ever visited — the only ground any scoring rule can move:
 *
 *     alpha   john    katie   jemima  rory    fintan
 *     0       66.1%   18.3%   29.5%   33.1%   17.4%   (win rate on contested cells)
 *     0.5     52.9%   27.8%   36.7%   43.1%   19.5%
 *     1       45.5%   30.6%   43.3%   49.3%   23.7%
 *
 * The household's runner covers about 2.7x the ground of its walkers per
 * outing (69.3 cells per person-day against 25.4), so under alpha=0 the board
 * was ranking distance. It is 1 because the game is meant to reward going out
 * often, not going out far — twenty walks now beat seven runs. What it does NOT
 * touch is the 91% of the map only one person has ever set foot on: no scoring
 * rule can redistribute uncontested ground, which is why the boards rank the
 * contest separately (see the landgrab page).
 *
 * The loop bonus survives: a closed loop's events still weigh 3x a trample's,
 * so an outing that encloses ground still out-claims one that merely crossed
 * it. Only SIZE stops paying.
 */
export const OUTING_ALPHA = 1;

/** What identifies one outing: a journey, or one workout. */
export interface OutingRef {
  subject: string;
  sourceRef: string;
}

/**
 * Divide each event's weight by the size of the outing it came from.
 *
 * Call this BEFORE anything reads a weight — before the ledger view the claim
 * writer resolves `tiles_taken` against, and before `dedupeEvents`, so that the
 * day's surviving claim on a cell is the STRONGEST one rather than whichever
 * outing happened to be processed first. Dedupe already prefers the higher
 * weight, a branch that existed for exactly this and was dead while weight was
 * a pure function of kind.
 *
 * It must see the whole outing at once: loop, trample and fill events are built
 * in three passes, and an outing's size is all three together. Splitting them
 * would pay a journey three separate allowances.
 */
export function applyOutingWeights<T extends CaptureEvent & OutingRef>(
  rows: T[],
  alpha: number = OUTING_ALPHA,
): T[] {
  if (!alpha) return rows;
  const key = (r: OutingRef) => `${r.subject}\u0000${r.sourceRef}`;
  const size = new Map<string, number>();
  for (const r of rows) size.set(key(r), (size.get(key(r)) ?? 0) + 1);
  // IN PLACE, and returning the same array. The ingest holds these rows in
  // several lists at once — the claim writer stamps ids onto the very objects
  // the ledger view has already indexed — so handing back copies would leave
  // half the run scoring at the un-weighted value. That is not hypothetical:
  // it is what made a nested claim report taking 12 cells while 25 changed
  // hands, because `tiles_taken` is resolved against that ledger view.
  for (const r of rows) {
    const n = size.get(key(r)) ?? 1;
    if (n > 1) r.weight = r.weight / Math.pow(n, alpha);
  }
  return rows;
}

/**
 * 'loop'    — a tile centroid inside a detected ring.
 * 'trample' — a tile the cleaned path crossed.
 * 'fill'    — a tile the journey's cell set enclosed without treading.
 *
 * All three are separate values of the (subject, tile, day, KIND) unique index,
 * which is the anti-farming key. Adding the third does not reopen that hole:
 * the fill set is disjoint from the loop and trample sets of the SAME journey
 * by construction (see fill.ts — closing is extensive, so nothing walked can
 * also be enclosed), and the per-day uniqueness still means ten laps score
 * once.
 */
export type CaptureKind = 'loop' | 'trample' | 'fill';

/** What one event of each kind is worth. Stored on the row, never re-derived. */
export const KIND_WEIGHT: Readonly<Record<CaptureKind, number>> = Object.freeze({
  loop: LOOP_WEIGHT,
  trample: TRAMPLE_WEIGHT,
  fill: FILL_WEIGHT,
});

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
  weight = KIND_WEIGHT[kind],
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

/**
 * Who held this cell in the instant before the current owner took it, or null
 * if nobody did.
 *
 * A replay of the same cell's events with the horizon set one millisecond
 * before the handover. `ownerSince` is the first event at which the current
 * owner led, so everything strictly before it is the prior regime; if that
 * regime had the same leader, the cell never changed hands and the answer is
 * null rather than a repeat of the owner's own name.
 *
 * `key` MUST come from `tileKeyOf`. This looks the cell up in a map
 * `resolveOwnership` built, and a caller that rolls its own `${x},${y}` gets a
 * miss rather than an error — which is how a maintenance rebuild wrote
 * `previous_owner` null across all 19,479 rows without failing.
 *
 * Lives here rather than beside the recompute that calls it because it is pure,
 * and because a maintenance script has to write `previous_owner` by the SAME
 * rule — `$lib/geo/service` cannot be imported outside vite (it reaches `$env`
 * through `$lib/db`), and a second copy of this rule would drift from the first
 * without anything failing.
 */
export function ownerBefore(
  events: CaptureEvent[],
  key: string,
  ownerSince: Date,
  owner: string,
): string | null {
  const priorMs = ownerSince.getTime() - 1;
  const before = events.filter((e) => e.capturedAt.getTime() <= priorMs);
  if (!before.length) return null;
  const prior = resolveOwnership(before, new Date(priorMs)).get(key);
  if (!prior || prior.owner === owner) return null;
  return prior.owner;
}
