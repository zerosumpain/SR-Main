// The language an admission rule is written in.
//
// A closed expression tree over the fact allow-list in ../mail-facts, validated
// here and interpreted by ./evaluate. Same shape and same reasoning as
// $lib/daydream/rules/spec.ts, which is the shipped precedent for "the model
// proposes DATA, code decides what data means".
//
// Two rules of the validator worth stating, because both were learned the hard
// way elsewhere in this codebase:
//
//   1. It REFUSES rather than coerces. Comparing a string fact with `gt` is
//      meaningless, and a validator that quietly coerced it would hide the
//      mistake until the rule was live and admitting the wrong mail (see
//      reference_tool_arg_alias_traps).
//   2. Depth and breadth are bounded. An unbounded tree is a denial-of-service
//      against the backtest, which evaluates every rule against every note.
//
// PURE — no DB, no clock, no network.

import { isMailFactKey, STRING_MAIL_FACTS, BOOLEAN_MAIL_FACTS, type MailFactKey } from '../mail-facts';

export const COMPARISONS = ['lt', 'lte', 'gt', 'gte', 'eq', 'neq'] as const;
export type Comparison = (typeof COMPARISONS)[number];

/** Comparisons that mean something about a string. */
const STRING_COMPARISONS: ReadonlySet<Comparison> = new Set(['eq', 'neq']);

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { fact: MailFactKey; op: Comparison; value: number | string | boolean };

/** What a rule does when it matches. There is no third option on purpose:
 *  a rule that could do anything other than decide admission would be a rule
 *  whose blast radius is not obvious from reading it. */
export type MailRuleAction = 'admit' | 'reject';

export interface MailRule {
  /** Stable id. Pinned once approved — the decision ledger cites it. */
  key: string;
  /** One line, in plain words, for the approval screen. */
  label: string;
  action: MailRuleAction;
  condition: Condition;
  /** 'proposed' | 'active' | 'declined'. NOTHING is ever created active. */
  status: 'proposed' | 'active' | 'declined';
  /** Where it came from — 'model' | 'seed' | 'owner'. */
  origin: string;
  /** The model's stated reason, or the seed's. */
  rationale?: string;
  proposedAt: string;
  decidedAt?: string;
  /** The backtest that was shown when it was approved. Kept so a rule that
   *  turns out badly can be compared against what it promised. */
  backtest?: MailRuleBacktest;
}

export interface MailRuleBacktest {
  /** Notes the rule matched, out of how many it was replayed over. */
  matched: number;
  scanned: number;
  /** Of the owner's own decisions, how often the rule agreed and disagreed. */
  agreed: number;
  disagreed: number;
  /** Threads the rule would admit that the owner had REJECTED. The number that
   *  matters — a rule that reintroduces refused mail is the failure mode. */
  falseAdmits: number;
  /** Matches per week over the replayed window; the flood check. */
  perWeek: number;
  /** Example subjects it matched, for the approval screen. */
  samples: string[];
}

/** Depth of nesting a condition may reach. */
export const MAX_DEPTH = 4;
/** Children one `all`/`any` may hold. */
export const MAX_BRANCHES = 8;
/** Total leaf conditions in a rule. */
export const MAX_LEAVES = 16;

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Validate a condition tree.
 *
 * Errors accumulate rather than short-circuiting: a proposal with three
 * mistakes should come back with three, so the next attempt can fix all of
 * them, rather than trickling one per round trip.
 */
export function validateCondition(node: unknown, depth = 0, counter = { leaves: 0 }): ValidationResult {
  const errors: string[] = [];
  const fail = (msg: string): ValidationResult => ({ ok: false, errors: [msg] });

  if (depth > MAX_DEPTH) return fail(`condition nests deeper than ${MAX_DEPTH}`);
  if (!isRecord(node)) return fail('a condition must be an object');

  const keys = Object.keys(node);
  if (keys.length !== 1 && !('fact' in node)) {
    return fail(`a condition has exactly one of all/any/not/fact, got: ${keys.join(', ') || 'nothing'}`);
  }

  if ('all' in node || 'any' in node) {
    const which = 'all' in node ? 'all' : 'any';
    const branches = (node as Record<string, unknown>)[which];
    if (!Array.isArray(branches) || branches.length === 0) return fail(`\`${which}\` needs a non-empty array`);
    if (branches.length > MAX_BRANCHES) return fail(`\`${which}\` has more than ${MAX_BRANCHES} branches`);
    for (const branch of branches) {
      const result = validateCondition(branch, depth + 1, counter);
      if (!result.ok) errors.push(...result.errors);
    }
    return { ok: errors.length === 0, errors };
  }

  if ('not' in node) {
    return validateCondition((node as Record<string, unknown>).not, depth + 1, counter);
  }

  if ('fact' in node) {
    counter.leaves += 1;
    if (counter.leaves > MAX_LEAVES) return fail(`a rule may test at most ${MAX_LEAVES} facts`);

    const { fact, op, value } = node as { fact: unknown; op: unknown; value: unknown };
    if (!isMailFactKey(fact)) {
      return fail(`unknown fact \`${String(fact)}\` — a rule may only read the documented facts`);
    }
    if (typeof op !== 'string' || !(COMPARISONS as readonly string[]).includes(op)) {
      return fail(`unknown comparison \`${String(op)}\` on \`${fact}\``);
    }
    const comparison = op as Comparison;

    if (STRING_MAIL_FACTS.has(fact)) {
      if (typeof value !== 'string') return fail(`\`${fact}\` compares against a string, got ${typeof value}`);
      if (!STRING_COMPARISONS.has(comparison)) {
        return fail(`\`${fact}\` is a string — \`${comparison}\` is meaningless on it; use eq or neq`);
      }
      return { ok: true, errors: [] };
    }

    if (BOOLEAN_MAIL_FACTS.has(fact)) {
      if (typeof value !== 'boolean') return fail(`\`${fact}\` compares against true or false, got ${typeof value}`);
      if (!STRING_COMPARISONS.has(comparison)) {
        return fail(`\`${fact}\` is a boolean — use eq or neq, not \`${comparison}\``);
      }
      return { ok: true, errors: [] };
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return fail(`\`${fact}\` compares against a number, got ${typeof value}`);
    }
    return { ok: true, errors: [] };
  }

  return fail(`a condition has exactly one of all/any/not/fact, got: ${keys.join(', ')}`);
}

/** Validate a whole proposed rule. */
export function validateRule(candidate: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(candidate)) return { ok: false, errors: ['a rule must be an object'] };

  const key = candidate.key;
  if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9-]{2,48}$/.test(key)) {
    errors.push('`key` must be lowercase kebab-case, 3–49 characters');
  }
  if (typeof candidate.label !== 'string' || candidate.label.trim().length < 4) {
    errors.push('`label` must be a sentence a person can read');
  }
  if (candidate.action !== 'admit' && candidate.action !== 'reject') {
    errors.push('`action` must be "admit" or "reject"');
  }
  // A rule is never born active. This is checked rather than merely defaulted,
  // because "nothing auto-activates" is the promise the whole feature rests on
  // and a proposal that ASKED to be active is exactly what must be refused.
  if (candidate.status !== undefined && candidate.status !== 'proposed') {
    errors.push('a proposed rule must have status "proposed" — rules are activated by the owner, never by the proposer');
  }

  const condition = validateCondition(candidate.condition);
  if (!condition.ok) errors.push(...condition.errors);

  return { ok: errors.length === 0, errors };
}

/** Render a condition as the sentence shown on the approval screen. */
export function describeCondition(node: Condition): string {
  if ('all' in node) return node.all.map(describeCondition).join(' and ');
  if ('any' in node) return `(${node.any.map(describeCondition).join(' or ')})`;
  if ('not' in node) return `not ${describeCondition(node.not)}`;
  const words: Record<Comparison, string> = {
    lt: 'is under',
    lte: 'is at most',
    gt: 'is over',
    gte: 'is at least',
    eq: 'is',
    neq: 'is not',
  };
  return `${node.fact} ${words[node.op]} ${JSON.stringify(node.value)}`;
}
