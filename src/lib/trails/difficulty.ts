// Difficulty grading — a second axis, deliberately separate from the quality
// score. The score in `scoring.ts` says whether a route is a *good loop*
// (retracing, spurs, surface fit); this says how *hard* it will be. A clean,
// flat 5 km and a clean 25 km over two summits can both score 95.
//
// The measure is Naismith equivalence: every 100 m of climb costs about the
// same effort as 1 km on the flat, so `km + ascent/100` gives one number that
// can be banded per sport. The bands are calibrated to a reasonably fit
// amateur, not a racer — "hard" means "you will feel this tomorrow".

import { estimateTimeS } from './field/nav';

export type DifficultyBand = 'easy' | 'moderate' | 'hard' | 'severe';

export interface DifficultyInput {
  distanceM: number;
  /** null when the geometry carries no elevation (e.g. a shared OSM route). */
  ascentM: number | null;
  sport: string;
  /** Share (0..1) of the distance on steps, when the router reported it. */
  stepsShare?: number;
}

export interface Difficulty {
  band: DifficultyBand;
  /** km + 100 m of climb per km, nudged up when a share of it is steps. */
  equivalentKm: number;
  /** Naismith moving-time estimate for this sport, in seconds. */
  estimatedTimeS: number;
  /** True when there was no elevation data, so the grade leans on distance alone. */
  climbUnknown: boolean;
  reasons: string[];
}

export const DIFFICULTY_LABELS: Record<DifficultyBand, string> = {
  easy: 'Easy',
  moderate: 'Moderate',
  hard: 'Hard',
  severe: 'Severe',
};

// Upper bounds of easy / moderate / hard in equivalent-km; beyond is severe.
// Riding bands are wider because a flat km costs a cyclist far less.
const BANDS: Record<string, [number, number, number]> = {
  walk: [6, 12, 20],
  hike: [10, 18, 28],
  run: [8, 14, 22],
  trail_run: [9, 16, 26],
  ride: [35, 70, 110],
  mtb: [20, 40, 65],
};

export function gradeDifficulty(input: DifficultyInput): Difficulty {
  const km = Math.max(0, input.distanceM) / 1000;
  const ascent = input.ascentM;
  const climbUnknown = typeof ascent !== 'number';

  let equivalentKm = km + (climbUnknown ? 0 : Math.max(0, ascent) / 100);

  const stepsShare = input.stepsShare ?? 0;
  if (stepsShare > 0.01) {
    // Steps break rhythm out of proportion to their length; 5% steps ≈ +10%.
    equivalentKm *= 1 + stepsShare * 2;
  }

  const [easyMax, moderateMax, hardMax] = BANDS[input.sport] ?? BANDS.run;
  const band: DifficultyBand =
    equivalentKm < easyMax
      ? 'easy'
      : equivalentKm < moderateMax
        ? 'moderate'
        : equivalentKm < hardMax
          ? 'hard'
          : 'severe';

  const reasons: string[] = [];
  if (climbUnknown) {
    reasons.push('No elevation data for this geometry — graded on distance alone.');
  } else if (ascent >= 10) {
    reasons.push(
      `${km.toFixed(1)} km with ${Math.round(ascent)} m of climb — ${equivalentKm.toFixed(1)} equivalent-km.`,
    );
  } else {
    reasons.push(`${km.toFixed(1)} km, essentially flat.`);
  }
  if (stepsShare > 0.01) {
    reasons.push(`${Math.round(stepsShare * 100)}% of the distance is on steps.`);
  }

  return {
    band,
    equivalentKm: Number(equivalentKm.toFixed(1)),
    estimatedTimeS: Math.round(estimateTimeS(input.distanceM, climbUnknown ? 0 : ascent, input.sport)),
    climbUnknown,
    reasons,
  };
}
