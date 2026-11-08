// The County Fair (WP3, spec §8.9): six award categories drawn each week from
// a pool of ten, every one per head or a rate of improvement, scored as an
// average over the whole week (never a snapshot), so a small town that is
// doing well wins as often as a big one. A town wins at most two a week, and
// ties go to the smaller town. A mayor with no award for two weeks gets the
// Editor's Mention for their best relative improvement: recognition at
// least once a fortnight is structural, not luck. Prizes are cosmetic or
// one-off, never a permanent multiplier.

import { h32, STREAMS } from './rand';
import type { WeekTown } from './types';

export const AWARD_POOL = [
  'mostImprovedMood',
  'happiest',
  'greenest',
  'safest',
  'bestReviews',
  'cultureStar',
  'fastestGrowing',
  'bestBudget',
  'kindestNeighbour',
  'bestGettingAround',
] as const;
export type AwardKey = (typeof AWARD_POOL)[number];

/** One town's score per AWARD_POOL category for the week (higher is better). */
export function awardScores(w: WeekTown): number[] {
  const d = Math.max(1, w.days);
  const perK = Math.max(1, w.pop1 / 1000);
  return [
    w.mood1 - w.mood0,
    w.happy / d,
    -(w.pollution / d),
    w.safety / d,
    w.rep / d,
    w.culture1 - w.culture0,
    w.pop0 > 0 ? (w.pop1 - w.pop0) / w.pop0 : 0,
    w.revenue > 0 ? (w.revenue - w.spending) / w.revenue : 0,
    w.kind / perK,
    w.around / d,
  ];
}

/** This week's categories: `count` of the pool, drawn by a seeded shuffle of (county seed, week). */
export function drawCategories(seed: number, week: number, count: number): number[] {
  const idx = AWARD_POOL.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = h32(seed, STREAMS.gazette, week, i, 1) % (i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, Math.min(count, idx.length));
}

export interface Entrant {
  town: number;
  pop: number;
  scores: number[];
}

/** Ranks entrants for a category: best score first, ties to the smaller town, then the lower index. */
export function rankFor(entrants: readonly Entrant[], cat: number): Entrant[] {
  return [...entrants].sort((a, b) => {
    const d = (b.scores[cat] ?? 0) - (a.scores[cat] ?? 0);
    if (Math.abs(d) > 1e-9) return d;
    return a.pop - b.pop || a.town - b.town;
  });
}

/** The week's winners: each category to its best entrant that has not already won `maxPerTown`. */
export function pickAwards(entrants: readonly Entrant[], categories: readonly number[], maxPerTown: number): { town: number; award: AwardKey }[] {
  const won = new Map<number, number>();
  const out: { town: number; award: AwardKey }[] = [];
  for (const cat of categories) {
    for (const e of rankFor(entrants, cat)) {
      if ((won.get(e.town) ?? 0) >= maxPerTown) continue;
      won.set(e.town, (won.get(e.town) ?? 0) + 1);
      out.push({ town: e.town, award: AWARD_POOL[cat] });
      break;
    }
  }
  return out;
}

/**
 * A town's best relative improvement for the Editor's Mention: the category
 * (of the whole pool) where it ranks highest among the entrants, earlier in
 * the pool on ties.
 */
export function bestCategory(entrants: readonly Entrant[], town: number): AwardKey {
  let best = 0;
  let bestRank = Infinity;
  for (let cat = 0; cat < AWARD_POOL.length; cat++) {
    const rank = rankFor(entrants, cat).findIndex((e) => e.town === town);
    if (rank >= 0 && rank < bestRank) {
      bestRank = rank;
      best = cat;
    }
  }
  return AWARD_POOL[best];
}
