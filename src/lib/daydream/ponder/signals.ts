// src/lib/daydream/ponder/signals.ts
//
// Who gets a seat in the pack's view of the signal registry, and what each
// card says beyond a mean.
//
// PURE — no database, no clock passed in rather than read. The split that
// decides what the model can see of 315 registered signals is exactly the kind
// of thing that should be testable without standing a Postgres up, for the same
// reason `assemblePack` is pure: it is the surface that decides what can be
// thought about at all.

/** How many discovered signals may reach one pack. A limit on the pack, not
 *  a claim that nothing else exists — the sweep still sees all of them. */
export const PACK_SIGNAL_LIMIT = 15;

/**
 * How the seats are split.
 *
 * Ranking every seat by movement sounds right and is not: the same handful of
 * signals move most every week, so the same handful took all fifteen seats
 * every cycle. Measured 2026-09-17 — 315 signals registered, 258 with enough
 * history to be testable, and the pack had been showing essentially one set.
 * The open registry's promise is that a source joins by calling
 * `registerSignals()`; it does, and then stops at this boundary.
 *
 * So a third of the seats are a ROTATION. Everything eligible takes its turn
 * on a cursor that steps once per cycle, which walks the whole registry in
 * about a week and costs the movers five seats they were only using to repeat
 * themselves.
 */
export const SIGNAL_MOVER_SEATS = 10;
export const SIGNAL_ROTATION_SEATS = PACK_SIGNAL_LIMIT - SIGNAL_MOVER_SEATS;

/** Cycle length the rotation cursor steps on — the ponder cadence. Derived
 *  from the clock rather than stored, so there is no cursor row to drift. */
export const SIGNAL_ROTATION_STEP_MS = 2 * 3_600_000;

/** Days of history behind each card. The recent window is what gets quoted;
 *  the prior window is only ever used to say whether the recent one is
 *  unusual for this signal. */
export const SIGNAL_RECENT_DAYS = 7;
export const SIGNAL_PRIOR_DAYS = 28;

/** How far the recent mean must sit from the prior mean, in prior standard
 *  deviations, before the card says so. 1.5 is deliberately loose: this is a
 *  prompt hint that something is worth looking at, not a test — the sweep and
 *  the hypothesis machinery are what make claims, under FDR control. */
const SIGNAL_SHIFT_SDS = 1.5;
/** Prior days needed before a shift is worth mentioning at all. */
const SIGNAL_SHIFT_MIN_PRIOR_DAYS = 7;

export interface SignalRow {
  key: string;
  label: string;
  unit: string | null;
  mean: number | null;
  lo: number | null;
  hi: number | null;
  days: number;
  priorMean: number | null;
  priorSd: number | null;
  priorDays: number;
  lastDay: string | null;
}

export function roundFigure(n: number): number {
  return Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
}

/**
 * What this signal is DOING, in a clause, or ''.
 *
 * The old card was a mean and a range, which is a reading and not an
 * observation — nothing in "mean 21.4 °C, range 20.1–22.8" tells the model
 * whether that is ordinary for this sensor. A shape is the part a crossing can
 * be built on: it has moved, it has stopped reporting, it has only just
 * started, it has not budged.
 *
 * Every branch is arithmetic over rows already fetched. No extra query, and
 * nothing here asserts causation — the words are deliberately observational.
 */
export function signalShape(r: SignalRow, today: string): string {
  if (r.mean == null) return '';
  if (r.lastDay && r.lastDay < today) {
    const gap = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.lastDay}T00:00:00Z`)) / 86_400_000);
    if (gap >= 2) return ` No reading for ${gap} days — last was ${r.lastDay}.`;
  }
  if (r.priorDays === 0 && r.days >= 2) return ' First readings from this signal — nothing before this week.';
  if (
    r.priorMean != null &&
    r.priorSd != null &&
    r.priorSd > 1e-9 &&
    r.priorDays >= SIGNAL_SHIFT_MIN_PRIOR_DAYS
  ) {
    const delta = r.mean - r.priorMean;
    if (Math.abs(delta) >= SIGNAL_SHIFT_SDS * r.priorSd) {
      const dir = delta > 0 ? 'higher' : 'lower';
      return ` That is ${roundFigure(Math.abs(delta))}${r.unit ? ` ${r.unit}` : ''} ${dir} than its previous ${r.priorDays}-day average of ${roundFigure(r.priorMean)}${r.unit ? ` ${r.unit}` : ''}.`;
    }
  }
  if (r.lo != null && r.hi != null && r.hi === r.lo && r.days >= 5) {
    return ` Unchanged every day for ${r.days} days.`;
  }
  return '';
}

/**
 * Choose which signals get a seat: movers first, then a rotation over the rest.
 *
 * PURE, so the split that decides what the model can see about the registry is
 * testable without a database — the same reason `assemblePack` is pure.
 */
export function chooseSignals(
  rows: SignalRow[],
  cursor: number,
  limit = PACK_SIGNAL_LIMIT,
): SignalRow[] {
  const eligible = rows.filter((r) => r.mean != null && r.days >= 2);
  if (eligible.length <= limit) return eligible;

  const spreadOf = (r: SignalRow) =>
    r.hi != null && r.lo != null && Math.abs(r.mean as number) > 1e-9
      ? (r.hi - r.lo) / Math.abs(r.mean as number)
      : 0;

  const moverSeats = Math.min(SIGNAL_MOVER_SEATS, limit);
  const movers = [...eligible].sort((a, b) => spreadOf(b) - spreadOf(a)).slice(0, moverSeats);
  const taken = new Set(movers.map((r) => r.key));

  // Stable order, so the cursor walks the same ring every cycle and a signal
  // cannot be skipped forever by an unrelated one being added.
  const rest = eligible.filter((r) => !taken.has(r.key)).sort((a, b) => a.key.localeCompare(b.key));
  const seats = Math.min(SIGNAL_ROTATION_SEATS, limit - movers.length, rest.length);
  const rotation: SignalRow[] = [];
  if (rest.length && seats > 0) {
    const start = ((cursor % rest.length) + rest.length) % rest.length;
    for (let i = 0; i < seats; i++) rotation.push(rest[(start + i) % rest.length]);
  }
  return [...movers, ...rotation];
}

