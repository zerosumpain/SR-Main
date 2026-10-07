// What the rambler is allowed to know about the owner's day: coarse flags
// only. The landing page is public, so it never carries the totals themselves,
// times or places — "exercised today", not "ran 5.2 km at 07:10". Everything
// here is a daily sum that is over by the time it shows, so it cannot tell a
// stranger where anyone is right now.

export interface DayTotals {
  steps: number;
  exerciseMin: number;
  flights: number;
  cyclingKm: number;
  walkRunKm: number;
  mindfulMin: number;
  daylightMin: number;
}

export interface DayFlags {
  /** Under 3,000, 3,000–10,000, or over 10,000 steps so far today. */
  steps: 'low' | 'mid' | 'high';
  exercised: boolean;
  climbed: boolean;
  cycled: boolean;
  walkedFar: boolean;
  mindful: boolean;
  outdoors: boolean;
  /** Last night's sleep from WHOOP: under 6 h (low), 6 to 8 h (mid), over 8 h (high). */
  sleep?: 'low' | 'mid' | 'high' | null;
  /** Today's WHOOP recovery: red (low), yellow (mid), green (high). */
  recovery?: 'low' | 'mid' | 'high' | null;
  /**
   * Movement over the last 45 minutes: still, some, active. Null when the
   * phone has not synced in the past half hour, so a gap never reads as sitting.
   */
  moving?: 'still' | 'some' | 'active' | null;
}

export const NO_DAY: DayFlags = {
  steps: 'mid',
  exercised: false,
  climbed: false,
  cycled: false,
  walkedFar: false,
  mindful: false,
  outdoors: false,
};

export function dayFlags(t: DayTotals): DayFlags {
  return {
    steps: t.steps < 3000 ? 'low' : t.steps > 10000 ? 'high' : 'mid',
    exercised: t.exerciseMin >= 20,
    climbed: t.flights >= 10,
    cycled: t.cyclingKm >= 1,
    walkedFar: t.walkRunKm >= 5,
    mindful: t.mindfulMin >= 5,
    outdoors: t.daylightMin >= 60,
  };
}

/** Hours slept to a band; null when there is no night on record. */
export function sleepBand(hours: number | null): 'low' | 'mid' | 'high' | null {
  if (hours === null || !Number.isFinite(hours) || hours <= 0) return null;
  return hours < 6 ? 'low' : hours > 8 ? 'high' : 'mid';
}

/** WHOOP's own colour bands: red under 34, yellow to 66, green above. */
export function recoveryBand(score: number | null): 'low' | 'mid' | 'high' | null {
  if (score === null || !Number.isFinite(score)) return null;
  return score < 34 ? 'low' : score < 67 ? 'mid' : 'high';
}

/** Steps in the last 45 minutes to a band; null when the data is not fresh. */
export function movingBand(steps45: number, fresh: boolean): 'still' | 'some' | 'active' | null {
  if (!fresh) return null;
  return steps45 < 150 ? 'still' : steps45 < 1200 ? 'some' : 'active';
}
