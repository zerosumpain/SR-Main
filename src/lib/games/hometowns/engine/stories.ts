// MoveStories (WP3, spec §8.4 item 4): every settled pair flow of 20
// people or more is explained. A story holds the cohort and the count, the
// top two reasons (the largest w[k,f]·(Ī_f[j] − Ī_f[i]) terms: what the
// winning town offers that cohort that the losing town does not), and a
// counter-move for the town that lost them: its own best relative strength
// for that cohort, and a suggested action key. The Gazette and the Bulletin
// render it ("120 Families moved from Sunnyvale to Oakridge. Why: Oakridge's
// secondary school and safer streets. Sunnyvale's rents are 20% lower:
// advertise that!"); the engine only supplies the data.

import { pp } from './region-state';
import { COHORT_S, STARS, STAR_TOWN, starTier, type CountyState, type MoveStory, type TownState } from './types';

/** What a mayor can do about each star, as an action key the app maps to a button (§9.7). */
export const STAR_ACTIONS: Readonly<Record<string, string>> = {
  jobs: 'zone.jobs',
  homes: 'zone.homes',
  tax: 'budget.homesTax',
  schools: 'build.school',
  health: 'build.health',
  safety: 'build.police',
  fun: 'build.park',
  culture: 'build.library',
  nature: 'build.trees',
  around: 'build.bus',
  buzz: 'build.attraction',
  needs: 'wants',
};

/** Ī_f for cohort k: the tier's own Jobs, Homes and Tax stars where it has them, else the town's. */
function star(t: TownState, f: number, k: number): number {
  if (f < 3) {
    const h = k === COHORT_S ? 0 : Math.floor(k / 3);
    const v = t.perceived[starTier(f as 0 | 1 | 2, h)];
    if (Number.isFinite(v)) return v;
  }
  return t.perceived[f] ?? 50;
}

/** The needs share a cohort sees (the snapshot's column), 1 when unknown. */
function needs(t: TownState, k: number): number {
  return t.peopleMemo?.needs?.[k] ?? 1;
}

/** Utility terms of moving from a to b for cohort k, per star then needs: w·(Ī_b − Ī_a)/50. */
export function reasonTerms(c: CountyState, a: TownState, b: TownState, k: number): number[] {
  const w = pp(c).migration.weights[k] ?? [];
  const out: number[] = [];
  for (let f = 0; f < STAR_TOWN; f++) out.push(((w[f] ?? 0) * (star(b, f, k) - star(a, f, k))) / 50);
  out.push((w[STAR_TOWN] ?? 0) * 2 * (needs(b, k) - needs(a, k)));
  return out;
}

const KEYS = [...STARS, 'needs'];

export function storyFor(c: CountyState, day: number, from: number, to: number, k: number, n: number): MoveStory {
  const terms = reasonTerms(c, c.towns[from], c.towns[to], k);
  const order = terms.map((_, f) => f).sort((x, y) => terms[y] - terms[x] || x - y);
  const reasons: string[] = [];
  const gaps: number[] = [];
  for (const f of order.slice(0, 2)) {
    reasons.push(KEYS[f]);
    gaps.push(Math.round(terms[f] * 1000) / 1000);
  }
  // The counter-move: where the losing town beats the winner most for this cohort.
  const best = order[order.length - 1];
  const strength = terms[best] < 0 ? KEYS[best] : null;
  // A strength is worth advertising; with none, fix the top reason.
  const action = strength ? 'advert' : STAR_ACTIONS[reasons[0]] ?? 'wants';
  return { day, from, to, cohort: k, n, reasons, gaps, strength, action };
}
