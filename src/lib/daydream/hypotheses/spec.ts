// src/lib/daydream/hypotheses/spec.ts
//
// What a model is allowed to wonder about, and the shape it has to wonder in.
//
// This is the rulesmith's bargain applied to exploration: the model chooses
// WHAT to look at, and deterministic code decides whether it is TRUE. The model
// never computes a correlation, never sees a p-value before proposing, and
// cannot phrase a finding that the test did not support.
//
// The pre-registration point matters more than it looks. A model that proposes
// a hypothesis BEFORE seeing any results has pre-registered it, so the
// multiple-comparisons correction runs over the handful it asked for rather
// than the several hundred an exhaustive sweep performs. That is not a
// convenience — it is the difference between q over m = 6 and q over m = 276,
// and it is why the proposer is given the metric catalogue and the coverage
// figures but never the correlation matrix. Letting it see the sweep first and
// then "propose" the winners is double-dipping, and it would silently void
// every guarantee in stats/tests.ts.
//
// PURE — no database, no model, no clock.

import { SWEEP_METRICS, isEntangled } from '../stats/sweep';
import { parseInvestigationPlan, type InvestigationPlan } from './plan';

export type HypothesisMetric = (typeof SWEEP_METRICS)[number];

/** Which way round the claim runs, and over what separation in days. */
export type Direction = 'positive' | 'negative' | 'either';

export interface HypothesisSpec {
  plan?: InvestigationPlan;
  /** The metric doing the predicting. */
  a: HypothesisMetric;
  /** The metric being predicted. */
  b: HypothesisMetric;
  /** 0 = same day. 1 = `a` today against `b` tomorrow. */
  lagDays: 0 | 1;
  /** What the model expects. Stated up front so a result that contradicts it is
   *  a refutation rather than a shrug. */
  direction: Direction;
  /** One line, in John's terms, on why this is worth an hour of anyone's day. */
  question: string;
  /** Why the model thinks it might hold. Never shown as fact. */
  rationale: string;
}

export const MAX_LAG_DAYS = 1;

export interface ValidationResult {
  ok: boolean;
  /** Why it was discarded. Rendered on the board, so a proposer that has
   *  started emitting nonsense is visible rather than silently ignored. */
  reason: string | null;
  spec: HypothesisSpec | null;
}

const METRIC_SET: ReadonlySet<string> = new Set(SWEEP_METRICS);
const DIRECTIONS: ReadonlySet<string> = new Set(['positive', 'negative', 'either']);

/** Stable identity for a claim, so the same question is not asked twice. */
export function hypothesisKey(s: Pick<HypothesisSpec, 'a' | 'b' | 'lagDays'>): string {
  // Same-day claims are symmetric — "sleep tracks steps" and "steps tracks
  // sleep" are one question — so the pair is sorted. A lagged claim is NOT
  // symmetric: which one comes first is the entire content of it.
  const pair = s.lagDays === 0 ? [s.a, s.b].sort().join('~') : `${s.a}->${s.b}`;
  return `${pair}@${s.lagDays}`;
}

/**
 * Check a proposal against everything it is not allowed to do.
 *
 * Deliberately strict and deliberately silent about how to pass: a proposer
 * that learns to game the validator by trial and error is a proposer producing
 * whatever passes rather than whatever is worth asking.
 */
/** Whether a metric name is a registered SIGNAL key rather than a day-feature
 *  column — `ha:sensor.x#state`, `tool:name#field`, `weather:…`. */
export function isSignalKey(metric: string): boolean {
  return metric.includes(':');
}

export function validateHypothesis(raw: unknown, allowed: ReadonlySet<string> = METRIC_SET): ValidationResult {
  const fail = (reason: string): ValidationResult => ({ ok: false, reason, spec: null });
  if (!raw || typeof raw !== 'object') return fail('not an object');
  const o = raw as Record<string, unknown>;

  const a = typeof o.a === 'string' ? o.a : '';
  const b = typeof o.b === 'string' ? o.b : '';
  if (!allowed.has(a)) return fail(`unknown metric: ${a || '(missing)'}`);
  if (!allowed.has(b)) return fail(`unknown metric: ${b || '(missing)'}`);
  if (a === b) return fail('a metric cannot predict itself');

  // The same list the exhaustive sweep uses. A model proposing "does resting
  // heart rate track recovery score" has proposed a restatement of how the
  // score is computed, and answering it would be this feature's idea of a
  // discovery.
  if (isEntangled(a, b)) return fail(`${a} and ${b} are entangled by definition`);

  const lagDays = typeof o.lagDays === 'number' ? o.lagDays : NaN;
  if (lagDays !== 0 && lagDays !== 1) return fail('lagDays must be 0 or 1');

  const direction = typeof o.direction === 'string' ? o.direction : '';
  if (!DIRECTIONS.has(direction)) return fail(`unknown direction: ${direction || '(missing)'}`);

  const question = typeof o.question === 'string' ? o.question.trim() : '';
  if (!question) return fail('no question');
  if (question.length > 200) return fail('question too long');

  const rationale = typeof o.rationale === 'string' ? o.rationale.trim() : '';
  if (!rationale) return fail('no rationale');
  if (rationale.length > 400) return fail('rationale too long');

  const plan = o.plan == null ? undefined : parseInvestigationPlan(o.plan);
  if (o.plan != null && !plan) return fail('invalid investigation plan');

  return {
    ok: true,
    reason: null,
    spec: {
      ...(plan ? { plan } : {}),
      a: a as HypothesisMetric,
      b: b as HypothesisMetric,
      lagDays: lagDays as 0 | 1,
      direction: direction as Direction,
      question,
      rationale,
    },
  };
}

// ── Verdicts ─────────────────────────────────────────────────────────────────

/**
 * What happened when the claim met the data.
 *
 * All four are first-class and all four are stored. `refuted` and `underpowered`
 * are the ones that usually get thrown away, and throwing them away is what
 * makes a system look prescient: only its hits survive. "I checked whether shop
 * visits track poor sleep; they do not, r = 0.06" is a genuinely useful thing to
 * read and currently has nowhere in this codebase to live.
 */
export type Verdict = 'supported' | 'refuted' | 'inconclusive' | 'underpowered' | 'wrong_direction';

export interface HypothesisOutcome {
  verdict: Verdict;
  r: number;
  p: number;
  qValue: number;
  n: number;
  /** Plain sentence, generated deterministically. Never by a model. */
  summary: string;
}

/** How many usable day-pairs before a verdict means anything. */
export const MIN_PAIRS_FOR_VERDICT = 20;
/** Statistical significance without a material effect is not a useful personal
 * discovery. */
export const MIN_ABS_R_FOR_VERDICT = 0.2;

/**
 * Turn a corrected test result into a verdict, deterministically.
 *
 * Note `wrong_direction`: a claim that predicted a positive relationship and
 * found a significant negative one has been REFUTED, not confirmed, even though
 * the p-value is small. Reporting that as a supported finding — because
 * something significant turned up — is the most seductive version of this
 * feature's failure mode, since the statistics genuinely are significant.
 */
export function judge(
  spec: Pick<HypothesisSpec, 'direction'>,
  stat: { r: number; p: number; qValue: number; n: number },
  fdr: number,
): HypothesisOutcome {
  const { r, p, qValue, n } = stat;
  const fmt = `r = ${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(2)}, n = ${n}`;

  if (n < MIN_PAIRS_FOR_VERDICT) {
    return {
      verdict: 'underpowered',
      r, p, qValue, n,
      summary: `Not enough overlapping days to answer this yet — ${n} of ${MIN_PAIRS_FOR_VERDICT} needed.`,
    };
  }

  if (qValue > fdr) {
    return {
      verdict: 'inconclusive',
      r, p, qValue, n,
      summary: `A relationship has not been established (${fmt}, q = ${qValue.toFixed(3)}).`,
    };
  }

  if (Math.abs(r) < MIN_ABS_R_FOR_VERDICT) {
    return {
      verdict: 'inconclusive',
      r, p, qValue, n,
      summary: `Observed effect below the practical threshold; practical benefit not established (${fmt}, minimum |r| = ${MIN_ABS_R_FOR_VERDICT.toFixed(2)}).`,
    };
  }

  const expectedSign = spec.direction === 'negative' ? -1 : spec.direction === 'positive' ? 1 : 0;
  if (expectedSign !== 0 && Math.sign(r) !== expectedSign) {
    return {
      verdict: 'wrong_direction',
      r, p, qValue, n,
      summary: `A real relationship, but the opposite way round from the claim (${fmt}, q = ${qValue.toFixed(3)}).`,
    };
  }

  return {
    verdict: 'supported',
    r, p, qValue, n,
    summary: `Held up as an association (${fmt}, q = ${qValue.toFixed(3)}). Competing explanations and practical benefit still need checking.`,
  };
}
