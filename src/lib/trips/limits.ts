// src/lib/trips/limits.ts
//
// The time ceilings of the planner's own model calls, in one place, so the
// async job cap (./jobs.server) is derived from them instead of guessed. A
// job capped below the work it runs reports "took too long" while the work
// carries on and saves — the person is told it failed when it did not.

/** One agentic planner turn (lookups and the final answer). */
export const PLANNER_TURN_MS = 180_000;
/** The check-and-correct call that follows a turn which changed the plan. */
export const CHECK_CALL_MS = 90_000;
/**
 * Room for everything else in a turn: storing messages, up to two re-solves
 * (each may route legs) and creating the trip row.
 */
export const TURN_SLACK_MS = 90_000;
/** The longest a conversation turn (or a trip's creation) can run. */
export const TURN_CEILING_MS = PLANNER_TURN_MS + CHECK_CALL_MS + TURN_SLACK_MS;
