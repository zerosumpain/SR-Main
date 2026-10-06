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
