// The advisors' rule bank (spec §9.7): well-formed data, every rule testable
// and worded at both copy levels, and a ranking by priority × severity that
// is deterministic and capped.

import { describe, expect, it } from 'vitest';
import { ADVISOR_FACTS, ADVISOR_RULES, advisorCopyKeys, ruleSeverity, selectAdvisors, type AdvisorFacts } from './advisors';

const calm = (): AdvisorFacts => {
  const f = {} as AdvisorFacts;
  for (const k of ADVISOR_FACTS) f[k] = 0;
  // A town with nothing to say: healthy stars, money and services.
  for (const k of ADVISOR_FACTS) if (k.startsWith('star')) f[k] = 70;
  Object.assign(f, { monthsReserve: 3, netShare: 0.05, rating: 1, approval: 70, mood: 70, satisfaction: 80, primarySeats: 1, secondarySeats: 1, homesTax: 8, businessTax: 4, pop: 5000 });
  return f;
};

describe('the rule bank', () => {
  it('has unique ids, known facts, a test, a span and an action on every rule, and all four advisors', () => {
    const ids = ADVISOR_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ADVISOR_RULES.length).toBeGreaterThanOrEqual(40);
    for (const r of ADVISOR_RULES) {
      expect(ADVISOR_FACTS).toContain(r.fact);
      expect((r.above !== undefined) !== (r.below !== undefined)).toBe(true);
      expect(r.span).toBeGreaterThan(0);
      expect(r.priority).toBeGreaterThanOrEqual(1);
      expect(r.priority).toBeLessThanOrEqual(5);
      expect(r.cooldownHours).toBeGreaterThanOrEqual(24);
      expect(r.action).toMatch(/^(build|zone|sheet|lens):\w+$/);
      expect(r.id.startsWith(`${r.advisor}.`)).toBe(true);
    }
    expect(new Set(ADVISOR_RULES.map((r) => r.advisor))).toEqual(new Set(['bramble', 'penny', 'mo', 'zia']));
    expect(advisorCopyKeys()).toHaveLength(2 * ADVISOR_RULES.length);
    // Data only: the bank survives a JSON round trip (it can ship as advisors.json).
    expect(JSON.parse(JSON.stringify(ADVISOR_RULES))).toEqual(ADVISOR_RULES);
  });

  it('says nothing about a calm town', () => {
    expect(selectAdvisors(calm(), 2, 3)).toEqual([]);
  });

  it('grows a rule’s severity over its span, from 0 at the threshold to 1', () => {
    const r = ADVISOR_RULES.find((x) => x.id === 'mo.jobsWanted')!;
    const f = calm();
    f.unemployment = 0.08;
    expect(ruleSeverity(r, f, 2)).toBe(0);
    f.unemployment = 0.155;
    expect(ruleSeverity(r, f, 2)).toBeCloseTo(0.5, 9);
    f.unemployment = 0.9;
    expect(ruleSeverity(r, f, 2)).toBe(1);
    const town = ADVISOR_RULES.find((x) => x.minTier === 2)!;
    const g = calm();
    g[town.fact] = town.above !== undefined ? town.above + town.span : town.below! - town.span;
    expect(ruleSeverity(town, g, 1)).toBe(0);
    expect(ruleSeverity(town, g, 2)).toBe(1);
  });

  it('ranks by priority × severity, ties by bank order, at most n', () => {
    const f = calm();
    f.unpowered = 0.5; // Bramble, priority 5, full severity
    f.unemployment = 0.155; // Mo, priority 4, half
    f.starFun = 25; // Zia, priority 3, half
    f.monthsReserve = 0.2; // Penny, priority 5, 0.8
    expect(selectAdvisors(f, 2, 3)).toEqual(['bramble.power', 'penny.reservesLow', 'mo.jobsWanted']);
    expect(selectAdvisors(f, 2, 10)).toContain('zia.fun');
    expect(selectAdvisors(f, 2, 10)).toEqual(selectAdvisors({ ...f }, 2, 10));
  });
});
