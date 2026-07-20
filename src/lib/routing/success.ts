// First-time-correct success aggregation. A model that reliably nails the query
// on the first try gets biased UP next selection; one that gets corrected gets
// biased down. Wilson lower bound (95%) is used rather than a raw rate so a
// 1/1 model can't leapfrog a proven 40/50 one — few samples stay pessimistic.
import type { ModelProfile, RoutingEvent } from './types';

/** Wilson score interval lower bound for a Bernoulli proportion. */
export function wilsonLower(correct: number, total: number, z = 1.96): number {
  if (total <= 0) return 0;
  const phat = correct / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const centre = phat + z2 / (2 * total);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total);
  return Math.max(0, (centre - margin) / denom);
}

export interface ProfileModelStat {
  profile: ModelProfile;
  modelId: string;
  correct: number;
  total: number;
  rate: number; // raw first-time-correct rate
  wilson: number; // lower bound used for the bias
}

/** Build a `${profile}:${modelId}` → stat index from decided events (those with a
 *  definite correctFirstTime signal). Undecided events are ignored. */
export function buildSuccessIndex(events: RoutingEvent[]): Map<string, ProfileModelStat> {
  const acc = new Map<string, { profile: ModelProfile; modelId: string; correct: number; total: number }>();
  for (const e of events) {
    if (e.correctFirstTime == null) continue;
    const key = `${e.profile}:${e.modelId}`;
    const cur = acc.get(key) ?? { profile: e.profile, modelId: e.modelId, correct: 0, total: 0 };
    cur.total += 1;
    if (e.correctFirstTime) cur.correct += 1;
    acc.set(key, cur);
  }
  const out = new Map<string, ProfileModelStat>();
  for (const [key, v] of acc) {
    out.set(key, {
      profile: v.profile,
      modelId: v.modelId,
      correct: v.correct,
      total: v.total,
      rate: v.total ? v.correct / v.total : 0,
      wilson: wilsonLower(v.correct, v.total),
    });
  }
  return out;
}

/** `successFor` factory for scoring.selectForProfile, scoped to one profile. */
export function successForProfile(
  index: Map<string, ProfileModelStat>,
  profile: ModelProfile,
): (modelId: string) => { rate: number | null; samples: number } {
  return (modelId: string) => {
    const stat = index.get(`${profile}:${modelId}`);
    if (!stat || stat.total === 0) return { rate: null, samples: 0 };
    return { rate: stat.wilson, samples: stat.total };
  };
}
