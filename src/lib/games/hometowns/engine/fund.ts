// The Development Fund's Sunday payout (WP3, spec §8.9). The Fund fills on
// any Regional Day when the largest town is more than twice the county
// median (it pays 1.5% of its day's revenue in: regional-day.ts). On Sunday
// it pays out to the towns below the median, in proportion to how far below
// they are, to the penny (largest remainder). Archived towns neither pay in
// nor receive, and do not count toward the median (A33).

import { population, postWhole } from './core';
import { largestRemainder } from './num';
import { countyMedian, isActive } from './region-state';
import type { CountyState } from './types';

/** Pays the Fund out; returns each town's grant (£, by index). */
export function payFund(c: CountyState): number[] {
  const out = c.towns.map(() => 0);
  const fund = Math.floor(c.fund);
  if (!(fund > 0)) return out;
  const med = countyMedian(c);
  const gaps = c.towns.map((t) => (isActive(t) && population(t) < med ? med - population(t) : 0));
  if (!gaps.some((x) => x > 0)) return out;
  const grants = largestRemainder(fund, gaps);
  grants.forEach((g, i) => {
    if (g <= 0) return;
    postWhole(c.towns[i], 'fundGrant', g);
    out[i] = g;
  });
  c.fund -= fund;
  return out;
}
