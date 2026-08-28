// src/lib/daydream/leads/score.ts
//
// Which line of enquiry gets the next round.
//
// The design constraint that shaped this file: a lead's priority must come from
// ITS OWN RESULTS, not from a constant somebody chose. The whole complaint that
// started this redesign was that the system was "too defined about what value
// feels like", and a frontier ordered by hand-tuned weights would be exactly
// the same mistake wearing a different hat.
//
// So every input below is something the lead has actually done — hypotheses it
// spawned, how many held, how many rounds it has run without producing
// anything — and the arithmetic is the same shrunk-posterior shape the kind
// weights already use, for the same reason: a brand-new lead with no evidence
// must sit at neutral rather than at zero, or nothing could ever prove itself.
//
// PURE. No database, no clock (callers pass `now`).

/** Pseudo-counts. Two imaginary hits and two imaginary misses, so a lead with
 *  no results yet scores exactly 0.5 and one early miss moves it to 0.4. */
export const PRIOR_HELD = 2;
export const PRIOR_EMPTY = 2;

/**
 * How much a barren round costs.
 *
 * Applied as a decay rather than a subtraction so it cannot drive a score
 * negative, and so a lead that goes quiet fades rather than falling off a
 * cliff — a line of enquiry can be barren for a fortnight because the data is
 * thin, not because it is wrong.
 */
export const BARREN_DECAY = 0.85;

/** A lead nobody has run for this long is stale enough to deprioritise. */
export const STALE_AFTER_DAYS = 21;

export interface LeadStats {
  hypothesesSpawned: number;
  hypothesesHeld: number;
  barrenRounds: number;
  roundsRun: number;
  lastRoundAt: Date | null;
  /** True when John explicitly asked for this line of enquiry. */
  fromSteer: boolean;
}

export interface LeadScore {
  score: number;
  components: Record<string, number>;
}

/**
 * Score a lead from what it has produced.
 *
 * `fromSteer` is the one input that is not a result, and it is a floor rather
 * than a boost: a line John asked for cannot be starved out by arithmetic
 * before it has had a fair run. That is a deliberate exception — his asking is
 * evidence of value even when the statistics have not caught up.
 */
export function scoreLead(stats: LeadStats, now: Date): LeadScore {
  const held = Math.max(0, stats.hypothesesHeld);
  const empty = Math.max(0, stats.hypothesesSpawned - stats.hypothesesHeld);

  // Shrunk posterior mean: neutral at no evidence, moves with real results.
  const yield_ = (held + PRIOR_HELD) / (held + empty + PRIOR_HELD + PRIOR_EMPTY);

  const barren = Math.pow(BARREN_DECAY, Math.max(0, stats.barrenRounds));

  let staleness = 1;
  if (stats.lastRoundAt) {
    const ageDays = (now.getTime() - stats.lastRoundAt.getTime()) / 86_400_000;
    // Older than the stale horizon fades linearly, floored so a long-quiet lead
    // is deprioritised rather than deleted by arithmetic.
    if (ageDays > STALE_AFTER_DAYS) {
      staleness = Math.max(0.4, 1 - (ageDays - STALE_AFTER_DAYS) / (STALE_AFTER_DAYS * 3));
    }
  }

  let score = yield_ * barren * staleness;

  // A line he asked for gets a floor, not a multiplier.
  const steerFloor = stats.fromSteer ? 0.45 : 0;
  if (score < steerFloor) score = steerFloor;

  return {
    score: Math.round(Math.min(1, Math.max(0, score)) * 1000) / 1000,
    components: {
      yield: Math.round(yield_ * 1000) / 1000,
      barrenDecay: Math.round(barren * 1000) / 1000,
      staleness: Math.round(staleness * 1000) / 1000,
      steerFloor,
      held,
      empty,
    },
  };
}

/**
 * Has this line of enquiry run out?
 *
 * A count of consecutive barren rounds, compared against the lead's OWN
 * threshold rather than a global constant — so the number can be tuned from
 * measured behaviour later without a migration, and so a steered lead can carry
 * a more patient one.
 *
 * A lead John asked for is never abandoned automatically. He opened it; he
 * closes it. Quietly dropping something he explicitly asked about is the exact
 * behaviour that would make the steer box worthless.
 */
export function shouldAbandon(stats: LeadStats, abandonAfterBarrenRounds: number): boolean {
  if (stats.fromSteer) return false;
  return stats.barrenRounds >= Math.max(1, abandonAfterBarrenRounds);
}

/** Order the frontier. Highest score first, ties broken by fewer rounds run so
 *  a new lead gets a look before an old one is re-run. */
export function rankLeads<T extends { score: number; roundsRun: number }>(leads: T[]): T[] {
  return leads.slice().sort((a, b) => b.score - a.score || a.roundsRun - b.roundsRun);
}
