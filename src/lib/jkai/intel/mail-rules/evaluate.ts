// Interpreting an admission rule. This is the code the "rules are data" promise
// cashes out to: the only thing that can ever happen is a comparison between a
// fact this module looked up and a literal the rule carried.
//
// PURE — no DB, no clock, no network.

import type { MailFacts } from '../mail-facts';
import type { Comparison, Condition, MailRule } from './spec';

function compare(actual: unknown, op: Comparison, expected: unknown): boolean {
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
      // Unreachable via a validated rule. Refusing rather than throwing keeps
      // one malformed stored rule from taking down a whole backtest.
      return false;
  }
}

/** Does this thread satisfy the condition? */
export function evaluateCondition(condition: Condition, facts: MailFacts): boolean {
  if ('all' in condition) return condition.all.every((c) => evaluateCondition(c, facts));
  if ('any' in condition) return condition.any.some((c) => evaluateCondition(c, facts));
  if ('not' in condition) return !evaluateCondition(condition.not, facts);
  return compare((facts as Record<string, unknown>)[condition.fact], condition.op, condition.value);
}

export interface RuleVerdict {
  /** The rule that decided, or null when none matched. */
  rule: MailRule | null;
  action: 'admit' | 'reject' | null;
}

/**
 * The first ACTIVE rule that matches, in order.
 *
 * `reject` rules are evaluated before `admit` rules regardless of their
 * position in the list. A refusal is the stronger statement — "never this
 * sender" has to beat "usually this shape", or a broad admit rule silently
 * overrides a narrow block and the owner's most specific instruction is the one
 * that stops working.
 */
export function decide(rules: MailRule[], facts: MailFacts): RuleVerdict {
  const active = rules.filter((r) => r.status === 'active');
  const ordered = [
    ...active.filter((r) => r.action === 'reject'),
    ...active.filter((r) => r.action === 'admit'),
  ];
  for (const rule of ordered) {
    if (evaluateCondition(rule.condition, facts)) return { rule, action: rule.action };
  }
  return { rule: null, action: null };
}
