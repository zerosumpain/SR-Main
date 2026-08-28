// src/lib/daydream/rules/spec.ts
//
// The language a model is allowed to write rules in.
//
// The whole safety story of this feature rests on one decision: **a proposed
// rule is DATA, never code.** The self-improvement engine lets a model author
// TypeScript and compiles it with `new AsyncFunction` in full Node scope, which
// is only survivable because of a deny-list static scan that its own docs
// describe as "the only thing between LLM-authored text and the environment".
// That is a lot of machinery to keep working forever, and a deny-list is a
// losing shape — you have to think of every escape.
//
// So rules here are a closed expression tree over an ALLOW-LIST of scalar
// facts, interpreted by code in evaluate.ts. There is no `eval`, no
// `new Function`, no property access by string, and no way to name anything
// that is not on the list. A malicious or confused proposal can produce a
// USELESS rule; it cannot produce a dangerous one. That is the difference
// between an allow-list and a deny-list, and it is why this is worth the
// interpreter.
//
// PURE — no DB, no clock, no network.

import { validateAction } from '../actions';

/**
 * Every fact a rule may reference. Adding one is a deliberate act: it widens
 * what rules can see, and each is derived by our own code in facts.ts.
 *
 * Deliberately scalar. A rule cannot walk an object graph, so it cannot reach
 * a coordinate, an email body, or a memory's text — the things that would
 * matter if a rule leaked into a prompt or a notification.
 */
export const FACT_KEYS = [
  // ── Time ──
  'localHour',
  'localDay',
  'isWeekday',
  // ── Position ──
  'isHome',
  'mode',
  'atPlaceKind',
  'atPlaceIsNamed',
  'minutesAtCurrentPlace',
  'nearestPlaceDistanceM',
  'nearestPlaceKind',
  'positionAgeMins',
  // ── Trail quality ──
  'trailSpanDays',
  'coverage24h',
  'coverage7d',
  // ── Health ──
  'daysSinceWorkout',
  'sleepPerformance',
  'sleepDropFromBaseline',
  'readinessScore',
  // ── Context ──
  'offersLiveCount',
  'offersNearbyCount',
  'calendarBusyNext2h',
  'calendarPartial',
  'unnamedPlaceCount',
  'recurringInterestCount',
  // ── Family ── (added 2026-08-27 with the owner's D1 decision; counts only,
  // never who or where — a scalar count cannot leak a person or a coordinate)
  'familyTracked',
  'familyAtHome',
] as const;

export type FactKey = (typeof FACT_KEYS)[number];

export function isFactKey(v: unknown): v is FactKey {
  return typeof v === 'string' && (FACT_KEYS as readonly string[]).includes(v);
}

/** Facts whose value is a string. Comparing these with `gt` is meaningless and
 *  is rejected rather than coerced — see the arg-alias lesson: a validator that
 *  coerces instead of refusing hides the mistake until it matters. */
export const STRING_FACTS: ReadonlySet<FactKey> = new Set([
  'mode',
  'atPlaceKind',
  'nearestPlaceKind',
]);

export const BOOLEAN_FACTS: ReadonlySet<FactKey> = new Set([
  'isWeekday',
  'isHome',
  'atPlaceIsNamed',
  'calendarBusyNext2h',
  'calendarPartial',
]);

export const COMPARISONS = ['lt', 'lte', 'gt', 'gte', 'eq', 'neq'] as const;
export type Comparison = (typeof COMPARISONS)[number];

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { fact: FactKey; op: Comparison; value: number | string | boolean };

/** One weighted contribution to a rule's score. */
export interface ScoreTerm {
  fact: FactKey;
  /** Value at which this term contributes 0. */
  from: number;
  /** Value at which it saturates at 1. */
  to: number;
  /** How much of the final score this term can contribute. */
  weight: number;
}

export interface RuleSpec {
  /** Stable identifier. Becomes the thought `kind`, so it must look like one. */
  kind: string;
  /** One line, shown on the detectors list. */
  description: string;
  /** Notification title. `{{place}}` is the only substitution. */
  title: string;
  /** Deterministic explanation. `{{place}}` and any fact as `{{factName}}`. */
  explanation: string;
  when: Condition;
  /** Base score before terms. 0..1. */
  base: number;
  terms: ScoreTerm[];
  /** Minimum days of trail before this rule may speak at all. */
  minTrailDays: number;
  /** How the thought dedupes: per day, per place, or per place per day. */
  dedupe: 'day' | 'place' | 'place-day' | 'week';
  /** Why the model proposed it — shown to the owner, never to the composer. */
  rationale: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Rules may not nest deeper than this. A deep tree is unreadable to the owner
 *  approving it, and unreadable is unapprovable. */
export const MAX_DEPTH = 4;
/** More conditions than this is not a rule, it is a fingerprint of one moment. */
export const MAX_CONDITIONS = 12;

const KIND_RE = /^[a-z][a-z0-9_]{2,48}$/;

function validateCondition(c: unknown, depth: number, errors: string[], counter: { n: number }): void {
  if (depth > MAX_DEPTH) {
    errors.push(`condition nests deeper than ${MAX_DEPTH}`);
    return;
  }
  if (!c || typeof c !== 'object') {
    errors.push('condition must be an object');
    return;
  }
  const obj = c as Record<string, unknown>;

  if ('all' in obj || 'any' in obj) {
    const list = (obj.all ?? obj.any) as unknown;
    if (!Array.isArray(list) || list.length === 0) {
      errors.push('all/any must be a non-empty array');
      return;
    }
    for (const child of list) validateCondition(child, depth + 1, errors, counter);
    return;
  }

  if ('not' in obj) {
    validateCondition(obj.not, depth + 1, errors, counter);
    return;
  }

  if ('fact' in obj) {
    counter.n++;
    if (counter.n > MAX_CONDITIONS) {
      errors.push(`more than ${MAX_CONDITIONS} conditions`);
      return;
    }
    if (!isFactKey(obj.fact)) {
      errors.push(`unknown fact "${String(obj.fact)}" — rules may only reference the allow-list`);
      return;
    }
    if (!COMPARISONS.includes(obj.op as Comparison)) {
      errors.push(`unknown comparison "${String(obj.op)}"`);
      return;
    }
    const fact = obj.fact as FactKey;
    const op = obj.op as Comparison;
    const value = obj.value;

    if (STRING_FACTS.has(fact)) {
      if (typeof value !== 'string') {
        errors.push(`${fact} compares against a string, got ${typeof value}`);
      } else if (op !== 'eq' && op !== 'neq') {
        // Ordering strings is meaningless here. Refused rather than coerced —
        // a validator that quietly accepts nonsense hides it until it fires.
        errors.push(`${fact} is a string; only eq/neq make sense, got ${op}`);
      }
      return;
    }
    if (BOOLEAN_FACTS.has(fact)) {
      if (typeof value !== 'boolean') {
        errors.push(`${fact} compares against a boolean, got ${typeof value}`);
      } else if (op !== 'eq' && op !== 'neq') {
        errors.push(`${fact} is a boolean; only eq/neq make sense, got ${op}`);
      }
      return;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${fact} compares against a finite number, got ${String(value)}`);
    }
    return;
  }

  errors.push('condition must be one of all / any / not / fact');
}

/**
 * Is this proposal safe and sane to run?
 *
 * Structural only — whether it is USEFUL is what the backtest answers, and
 * whether it is WANTED is what the owner answers. Three separate questions,
 * three separate gates, and this is the cheapest of them.
 */
export function validateRuleSpec(spec: unknown): ValidationResult {
  const errors: string[] = [];
  if (!spec || typeof spec !== 'object') return { ok: false, errors: ['not an object'] };
  const s = spec as Record<string, unknown>;

  if (typeof s.kind !== 'string' || !KIND_RE.test(s.kind)) {
    errors.push('kind must be lower_snake_case, 3–49 chars');
  }
  for (const field of ['description', 'title', 'explanation', 'rationale'] as const) {
    const v = s[field];
    if (typeof v !== 'string' || !v.trim()) errors.push(`${field} is required`);
    else if (v.length > 400) errors.push(`${field} is over 400 chars`);
  }

  if (typeof s.base !== 'number' || s.base < 0 || s.base > 1) {
    errors.push('base must be between 0 and 1');
  }
  if (typeof s.minTrailDays !== 'number' || s.minTrailDays < 0 || s.minTrailDays > 365) {
    errors.push('minTrailDays must be 0–365');
  }
  if (!['day', 'place', 'place-day', 'week'].includes(String(s.dedupe))) {
    errors.push('dedupe must be day, place, place-day or week');
  }

  if (!Array.isArray(s.terms)) {
    errors.push('terms must be an array');
  } else {
    if (s.terms.length > 5) errors.push('at most 5 score terms');
    let weightSum = 0;
    for (const t of s.terms as unknown[]) {
      const term = t as Record<string, unknown>;
      if (!isFactKey(term.fact)) {
        errors.push(`score term references unknown fact "${String(term.fact)}"`);
        continue;
      }
      if (STRING_FACTS.has(term.fact as FactKey) || BOOLEAN_FACTS.has(term.fact as FactKey)) {
        errors.push(`score term on ${String(term.fact)} — only numeric facts can be ramped`);
        continue;
      }
      for (const n of ['from', 'to', 'weight'] as const) {
        if (typeof term[n] !== 'number' || !Number.isFinite(term[n])) {
          errors.push(`score term ${n} must be a finite number`);
        }
      }
      if (typeof term.weight === 'number') weightSum += term.weight;
      if (term.from === term.to) errors.push('score term from and to must differ');
    }
    if (typeof s.base === 'number' && s.base + weightSum > 1.001) {
      // A rule that can score above 1 would outrank everything permanently.
      errors.push(`base plus term weights is ${(s.base + weightSum).toFixed(2)}, must be ≤ 1`);
    }
  }

  validateCondition(s.when, 1, errors, { n: 0 });

  if (s.action !== undefined) {
    const v = validateAction(s.action);
    if ('error' in v) errors.push(`action: ${v.error}`);
  }

  return { ok: errors.length === 0, errors };
}

/** Lifecycle. A rule only ever fires while `active`. */
export const RULE_STATUSES = ['proposed', 'active', 'rejected', 'deprecated'] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];
