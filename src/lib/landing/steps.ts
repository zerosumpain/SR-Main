// steps.ts — the pure half of the Steps channel: quarter-hour bins over a local
// day. The database read is in steps-today.server.ts.

export const STEP_BINS = 96;

export interface StepsToday {
  /** Steps per quarter-hour, index 0 = 00:00–00:15 local. */
  bins: number[];
  /** Null when no sample has arrived today, which is not the same as zero. */
  total: number | null;
  /** The bin the current time falls in; everything after it is the future. */
  nowBin: number;
}

/** Pure: place samples (unix seconds) into the day's bins. Exported for tests. */
export function binSteps(
  samples: Array<{ date: number; steps: number }>,
  bounds: { start: number; end: number },
  nowSec: number,
): StepsToday {
  const bins = new Array<number>(STEP_BINS).fill(0);
  const span = bounds.end - bounds.start; // 23h or 25h on clock-change days
  let total: number | null = null;
  for (const s of samples) {
    if (!Number.isFinite(s.steps) || s.steps < 0 || s.date < bounds.start || s.date >= bounds.end) continue;
    const i = Math.min(STEP_BINS - 1, Math.floor(((s.date - bounds.start) / span) * STEP_BINS));
    bins[i] += s.steps;
    total = (total ?? 0) + s.steps;
  }
  const nowBin = Math.max(0, Math.min(STEP_BINS - 1, Math.floor(((nowSec - bounds.start) / span) * STEP_BINS)));
  return { bins, total, nowBin };
}
