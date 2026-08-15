/**
 * Where a resumed run should start.
 *
 * `startResearch` used to be the only way back into a run, and it always began
 * at phase 1. That is fine for a new session and wrong for every other caller:
 *
 *  - The resume sweep adopts stranded sessions on every boot, and CI deploys on
 *    every merge to master. A production investigation ("Darlington running
 *    events", measured 2026-08-15) had been going nine hours, was adopted four
 *    minutes earlier, and was still in phase 1 with 113 sources and 66 leads —
 *    it had restarted lead generation on each of a dozen deploys and could
 *    never reach phase 2, let alone finish.
 *  - Pausing has the same problem in a sharper form: pausing during red-teaming
 *    and resuming into lead generation would be a bug wearing a feature's
 *    clothes.
 *
 * So the phase is a stored fact, and this module is the one place that reads it
 * back. `status` carries it while a run is live; `resumeFrom` carries it while
 * a run is paused, because pausing has to overwrite `status`.
 */

/** The phase chain an `investigation` walks, in order. */
export const PHASE_ORDER = ['phase1', 'phase2', 'phase3', 'post_processing'] as const;

export type ResearchPhase = (typeof PHASE_ORDER)[number];

export function isResearchPhase(value: unknown): value is ResearchPhase {
  return typeof value === 'string' && (PHASE_ORDER as readonly string[]).includes(value);
}

/**
 * Index into `PHASE_ORDER` to start from.
 *
 * Anything that is not a phase — 'draft', 'failed', 'complete', a status from a
 * future version, null — starts at the beginning. Starting over is the only
 * safe reading of "I do not know where this run got to"; skipping ahead on a
 * guess would silently drop the gathering step and produce an answer built on
 * nothing.
 */
export function startPhaseIndex(status: string | null | undefined): number {
  const i = PHASE_ORDER.indexOf(status as ResearchPhase);
  return i === -1 ? 0 : i;
}

/**
 * The phase a run should resume at, given its stored row. `resumeFrom` wins:
 * it is only ever written when a run is paused, and at that moment `status` has
 * already been overwritten with 'paused'.
 */
export function resumePhase(row: { status: string | null; resumeFrom?: string | null }): ResearchPhase {
  if (isResearchPhase(row.resumeFrom)) return row.resumeFrom;
  if (isResearchPhase(row.status)) return row.status;
  return 'phase1';
}
