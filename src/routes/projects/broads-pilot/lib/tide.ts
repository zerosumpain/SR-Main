// Advisory tide helper for the Broads Pilot Breydon crossing. Pure.
// NOT a tide predictor — it projects slack windows off a single known low
// water using the mean semidiurnal period. Display only.

/** Mean semidiurnal tidal period (s) = 12 h 25 m. */
const SEMIDIURNAL_S = 44700;
/** Slack water lags low water by ~1 h on the Yarmouth transit. */
const SLACK_OFFSET_S = 3600;
/** Half-width of a comfortable crossing window. */
const HALF_WINDOW_S = 90 * 60;

export interface SlackWindow {
  start: Date;
  mid: Date;
  end: Date;
}

/**
 * Project `count` slack-water crossing windows from a known low water.
 * Each window is centred at LW + 1 h and is ±90 min wide; successive windows
 * are spaced one semidiurnal period (≈12 h 25 m) apart.
 */
export function nextSlackWindows(refLowWater: Date, count = 4): SlackWindow[] {
  const windows: SlackWindow[] = [];
  const base = refLowWater.getTime();
  for (let i = 0; i < count; i++) {
    const midMs = base + (SLACK_OFFSET_S + i * SEMIDIURNAL_S) * 1000;
    windows.push({
      start: new Date(midMs - HALF_WINDOW_S * 1000),
      mid: new Date(midMs),
      end: new Date(midMs + HALF_WINDOW_S * 1000),
    });
  }
  return windows;
}

/** Fixed Breydon Water crossing guidance. */
export function breydonAdvice(): string {
  return 'Breydon Water is tidal — cross at slack water, about 1 hour after low water at Great Yarmouth. Plan ~2¼ h from Acle or ~2 h from Reedham. Keep inside the red & green posts.';
}
