// src/lib/daydream/rules/evaluate.ts
//
// Running a model-authored rule, safely.
//
// This is the interpreter that makes "the model writes rules" survivable. It
// walks a validated expression tree over a fixed fact vector. There is no eval,
// no dynamic property access, no I/O, and no way for a rule to name anything
// the fact extractor did not put in front of it.
//
// PURE.

import type { Comparison, Condition, RuleSpec, ScoreTerm } from './spec';
import type { FactValue, Facts } from './facts';

/**
 * Compare one fact.
 *
 * An unknown fact is FALSE for every comparison, including `neq`. That is not
 * an oversight: `neq` on a null would make "the sensor is down" satisfy
 * "you are not at home", which is the exact confusion between absence and
 * evidence that the coverage gate exists to prevent. A rule that wants to fire
 * on missing data has to say so through a fact that measures it, like
 * `coverage24h`.
 */
export function compare(actual: FactValue, op: Comparison, expected: unknown): boolean {
  if (actual === null || actual === undefined) return false;

  switch (op) {
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    default:
      return false;
  }
}

/** Walk the tree. Depth is bounded by the validator, so no guard is needed here. */
export function evaluateCondition(condition: Condition, facts: Facts): boolean {
  if ('all' in condition) return condition.all.every((c) => evaluateCondition(c, facts));
  if ('any' in condition) return condition.any.some((c) => evaluateCondition(c, facts));
  if ('not' in condition) return !evaluateCondition(condition.not, facts);
  return compare(facts[condition.fact], condition.op, condition.value);
}

/** One score term, ramped into 0..1 and weighted. */
export function termScore(term: ScoreTerm, facts: Facts): number {
  const v = facts[term.fact];
  if (typeof v !== 'number') return 0;
  const span = term.to - term.from;
  if (span === 0) return 0;
  const ramped = Math.min(1, Math.max(0, (v - term.from) / span));
  return ramped * term.weight;
}

export interface RuleOutcome {
  fired: boolean;
  score: number;
  components: Record<string, number>;
}

/** Would this rule fire right now, and how strongly? */
export function evaluateRule(spec: RuleSpec, facts: Facts): RuleOutcome {
  if (!evaluateCondition(spec.when, facts)) {
    return { fired: false, score: 0, components: {} };
  }
  const components: Record<string, number> = { base: spec.base };
  let score = spec.base;
  for (const term of spec.terms) {
    const contribution = termScore(term, facts);
    components[term.fact] = Math.round(contribution * 1000) / 1000;
    score += contribution;
  }
  return {
    fired: true,
    score: Math.min(1, Math.max(0, Math.round(score * 1000) / 1000)),
    components,
  };
}

/**
 * Fill a rule's template.
 *
 * Substitution is whitelisted to `{{place}}` plus the fact names, and anything
 * unmatched is left as literal text rather than blanked. A template that
 * silently renders an empty string is how a notification ends up saying
 * "You have been at  for  minutes" — visible nonsense is easier to fix than
 * invisible nonsense.
 */
export function renderTemplate(
  template: string,
  facts: Facts,
  place: { label: string | null },
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    if (key === 'place') return place.label ?? 'this place';
    if (Object.prototype.hasOwnProperty.call(facts, key)) {
      const v = facts[key as keyof Facts];
      return v === null || v === undefined ? whole : String(v);
    }
    return whole;
  });
}
