// tracking/freshness.ts — how stale the most recent observation is, relative to the
// indicator's expected release cadence. Drives the "data last updated" dot colour.

import type { FreshnessState } from './types';

export interface FreshnessInput {
  releaseDate: string | null; // official publish date (ISO)
  fetchedAt: string | null;   // when our poller last ran (ISO)
  live: boolean;              // false = snapshot fallback
  /** Months of the year a fresh release is expected; length = releases/year. */
  expectedReleaseMonths: number[];
  now?: Date;
}

const MS_PER_MONTH = 365.25 / 12 * 24 * 60 * 60 * 1000;

export function freshnessState(input: FreshnessInput): FreshnessState {
  const ref = input.releaseDate ?? input.fetchedAt;
  if (!ref) return 'no-data';
  if (!input.live) return 'snapshot';

  const now = input.now ?? new Date();
  const ageMonths = (now.getTime() - new Date(ref).getTime()) / MS_PER_MONTH;
  const releasesPerYear = Math.max(1, input.expectedReleaseMonths.length);
  const interval = 12 / releasesPerYear;

  if (ageMonths < interval) return 'fresh';
  if (ageMonths < interval * 1.5) return 'due';
  return 'stale';
}
