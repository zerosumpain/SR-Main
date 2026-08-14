/**
 * Wall-clock budget for a research run.
 *
 * The sub-2-minute tier is a promise about the CLOCK, not about how much work
 * gets done, so every bounded stage takes one of these and asks it two
 * questions: how long have I got, and what signal should I hang my awaits on.
 *
 * Two properties matter, both learned from the old engine:
 *
 *  - **Reserves.** `runResearch` used to check `isTimeUp()` only BETWEEN phases,
 *    so gathering would consume the entire allowance and synthesis — the part
 *    that actually produces an answer — got nothing. A reserve carves a slice
 *    off the tail that gathering cannot see: `remainingFor('gather')` returns
 *    zero while `remainingFor('synthesis')` still has its slice. The run
 *    degrades to "here is what I have" instead of returning nothing at all.
 *
 *  - **Signals, not just booleans.** A boolean checked between awaits cannot
 *    stop a Tavily call that hangs for 15s or an LLM call that takes 45s;
 *    that is how a 120s budget became a 180s run. `signalFor` hands back an
 *    AbortSignal that fires exactly when the stage's time is up, so the
 *    deadline is enforced INSIDE a stage rather than at its edges.
 */

/**
 * Named stages a budget can reserve time for. `gather` is everything that
 * collects material; `synthesis` is the part that turns it into an answer and
 * is the stage worth protecting.
 */
export type BudgetStage = 'gather' | 'synthesis';

export interface ResearchBudget {
  /** Total milliseconds left before the whole run is out of time. */
  remaining(): number;
  /** True once the total budget is gone. */
  expired(): boolean;
  /**
   * Milliseconds left for this stage. Non-reserved stages cannot see into the
   * reserved tail, so they stop early and leave it for the stage that owns it.
   */
  remainingFor(stage: BudgetStage): number;
  /** True once this stage in particular is out of time. */
  expiredFor(stage: BudgetStage): boolean;
  /**
   * An AbortSignal that fires when this stage runs out of time, optionally
   * capped tighter by `ceilingMs` (e.g. a per-call timeout that should never
   * exceed what the stage has left).
   */
  signalFor(stage: BudgetStage, ceilingMs?: number): AbortSignal;
}

/** Reserved milliseconds per stage, subtracted from what other stages may use. */
export type BudgetReserves = Partial<Record<BudgetStage, number>>;

function alreadyAborted(): AbortSignal {
  const ac = new AbortController();
  ac.abort(new Error('Research budget exhausted'));
  return ac.signal;
}

/**
 * Create a wall-clock budget of `totalMs`, optionally reserving a tail slice
 * for named stages. The clock starts now.
 */
export function createBudget(totalMs: number, reserves: BudgetReserves = {}): ResearchBudget {
  const start = Date.now();
  // A reserve can never exceed the whole budget — otherwise gathering would be
  // handed a negative allowance and the reserved stage would still only ever
  // have the real budget to spend.
  const reservedTotal = Math.min(
    totalMs,
    Object.values(reserves).reduce((sum: number, ms) => sum + (ms ?? 0), 0),
  );

  const remaining = (): number => Math.max(0, totalMs - (Date.now() - start));

  const remainingFor = (stage: BudgetStage): number => {
    const left = remaining();
    // A stage with its own reserve may spend everything that is left: by the
    // time it runs, the reserve IS the remainder.
    if (reserves[stage] != null) return left;
    return Math.max(0, left - reservedTotal);
  };

  return {
    remaining,
    expired: () => remaining() <= 0,
    remainingFor,
    expiredFor: (stage) => remainingFor(stage) <= 0,
    signalFor(stage, ceilingMs) {
      const left = remainingFor(stage);
      if (left <= 0) return alreadyAborted();
      const ms = ceilingMs != null ? Math.min(left, ceilingMs) : left;
      return AbortSignal.timeout(ms);
    },
  };
}

/**
 * The unbounded budget, for tiers that are explicitly not on a clock
 * (`investigation` with no time limit). Stages still get a signal so callers
 * need no special-casing — it just never fires on its own.
 */
export const NO_BUDGET: ResearchBudget = {
  remaining: () => Infinity,
  expired: () => false,
  remainingFor: () => Infinity,
  expiredFor: () => false,
  signalFor: (_stage, ceilingMs) =>
    ceilingMs != null ? AbortSignal.timeout(ceilingMs) : new AbortController().signal,
};
