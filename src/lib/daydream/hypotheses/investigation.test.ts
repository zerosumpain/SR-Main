import { describe, expect, it } from 'vitest';
import { pairEvidence } from './evidence';
import { developmentNeeds, parseInvestigationPlan } from './plan';

export const groceryPlan = {
  benefit: 'Check whether fewer small shopping trips could reduce grocery spending.',
  alternatives: ['Larger baskets rather than higher prices', 'Refunds and duplicate receipt/bank evidence'],
  support: 'Comparable baskets cost more on small-trip days in subsequent observations.',
  contradict: 'Comparable baskets cost the same after accounting for quantities.',
  missingEvidence: [
    { need: 'Receipt product quantities and unit prices', reason: 'Distinguish prices from quantities', route: 'build', acceptance: 'Extract item totals and reconcile them to the paid receipt total.' },
    { need: 'More complete days', reason: 'The current overlap is too short', route: 'observe', acceptance: 'Twenty overlapping days after the proposal.' },
  ],
};

describe('investigation plans', () => {
  it('carries the benefit, alternatives and acceptance checks without queuing observation as development', () => {
    const plan = parseInvestigationPlan(groceryPlan)!;
    expect(plan.alternatives).toHaveLength(2);
    expect(developmentNeeds(plan)).toEqual([groceryPlan.missingEvidence[0]]);
  });
  it('rejects unbounded or incomplete model output and invented action routes', () => {
    expect(parseInvestigationPlan({ ...groceryPlan, contradict: '' })).toBeNull();
    expect(parseInvestigationPlan({ ...groceryPlan, alternatives: Array(5).fill('Another possibility') })).toBeNull();
    expect(parseInvestigationPlan({ ...groceryPlan, missingEvidence: [{ ...groceryPlan.missingEvidence[0], route: 'execute' }] })).toBeNull();
  });
});

describe('chronological evidence', () => {
  it('does not turn missing dates into a next-day relationship', () => {
    const pairs = pairEvidence(['2026-08-01', '2026-08-03', '2026-08-04'], [1, 2, 3], [10, 20, 30], 1);
    expect(pairs.map((p) => [p.a, p.b, p.used])).toEqual([[1, null, false], [2, 30, true], [3, null, false]]);
  });
  it('excludes the proposal day and earlier observations from future validation', () => {
    expect(pairEvidence(['2026-08-01', '2026-08-02', '2026-08-03'], [1, 2, 3], [3, 2, 1], 0, '2026-08-02'))
      .toEqual([{ day: '2026-08-03', a: 3, b: 1, used: true }]);
  });
});
