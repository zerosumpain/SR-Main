// Replaying a proposed rule over the mail that already exists.
//
// A rule that has not been backtested is a guess, and this feature exists
// because a guess about which email matters cost the graph 8,974 junk entities.
// So before a rule can be offered for approval it is run against every note in
// the corpus and against every decision the OWNER has made, and the answer is
// shown as numbers rather than as a promise.
//
// Three questions, and the third is the one that matters:
//
//   1. How much would it admit? A rule that matches 1,900 of 2,781 threads is
//      not a rule, it is the old behaviour with extra steps.
//   2. How often does it agree with you? Measured only against the owner's own
//      decisions — never a rule's, or a rule would be marking its own homework.
//   3. How often would it admit something you REFUSED? `falseAdmits`. One is a
//      reason to look closer; a handful is a refusal.
//
// The auto-refusal thresholds below mirror the daydream rules engine, which
// refuses anything over 14 firings a week. Same instinct, different unit: there
// the cost of a bad rule is an interruption, here it is a poisoned graph.
//
// PURE apart from the corpus it is handed — the caller does the reading, so
// this whole module is testable against literals.

import { factsFor, type MailFacts, type NoteForFacts } from '../mail-facts';
import { evaluateCondition } from './evaluate';
import type { MailRule, MailRuleBacktest } from './spec';
import type { MailDecision } from '../mail-decisions';

/** A note as the backtest needs it. */
export interface CorpusNote extends NoteForFacts {
  id: string;
  graphState: string;
}

/**
 * Share of the corpus above which an admit rule is refused outright.
 *
 * A third of the mailbox is not a category, it is a shrug. Set against the
 * measured shape of the corpus: 1,323 of 2,781 threads classify as
 * correspondence, so a rule matching more than a third is necessarily broader
 * than "mail from people I know".
 */
export const MAX_ADMIT_SHARE = 0.33;

/** Admissions per week above which a rule is refused. At the observed rate of
 *  roughly 230 new threads a week, this is about a fifth of the mailbox. */
export const MAX_ADMITS_PER_WEEK = 50;

/** Threads the owner rejected that an admit rule would let back in. */
export const MAX_FALSE_ADMITS = 2;

export interface BacktestOptions {
  /** Wall clock for `ageDays`. Passed so a test is deterministic. */
  now: number;
  /** Sample subjects to carry back for the approval screen. */
  sampleLimit?: number;
}

/**
 * Replay one rule.
 *
 * `perWeek` is computed over the ACTUAL span of the corpus rather than a
 * nominal window: a rule replayed over eleven days of mail and reported as
 * "per week" without dividing by the real span overstates itself by a factor
 * of two, and every threshold downstream then means nothing.
 */
export function backtestRule(
  rule: Pick<MailRule, 'condition' | 'action'>,
  corpus: CorpusNote[],
  decisions: MailDecision[],
  opts: BacktestOptions,
): MailRuleBacktest {
  const { now } = opts;
  const sampleLimit = opts.sampleLimit ?? 5;

  const decisionByNote = new Map(decisions.map((d) => [d.noteId, d]));
  const samples: string[] = [];
  let matched = 0;
  let agreed = 0;
  let disagreed = 0;
  let falseAdmits = 0;
  let oldestMs = Number.POSITIVE_INFINITY;
  let newestMs = 0;

  for (const note of corpus) {
    const facts: MailFacts = factsFor(note, now);
    const when = note.observedAt ?? note.createdAt;
    const ms = when ? new Date(when).getTime() : NaN;
    if (Number.isFinite(ms)) {
      oldestMs = Math.min(oldestMs, ms);
      newestMs = Math.max(newestMs, ms);
    }

    if (!evaluateCondition(rule.condition, facts)) continue;
    matched++;
    if (samples.length < sampleLimit && note.title) samples.push(note.title.slice(0, 120));

    // Against the owner's own verdict, where there is one. A thread the owner
    // never ruled on is neither agreement nor disagreement, and counting it as
    // either is how a rule comes to look far better or far worse than it is.
    const decided = decisionByNote.get(note.id);
    if (!decided) continue;
    if (decided.decision === rule.action) agreed++;
    else {
      disagreed++;
      if (rule.action === 'admit' && decided.decision === 'reject') falseAdmits++;
    }
  }

  const spanDays =
    Number.isFinite(oldestMs) && newestMs > oldestMs ? (newestMs - oldestMs) / 86_400_000 : 0;
  // Floor of one week: a corpus spanning three days would otherwise multiply
  // its matches by 2.3 and refuse a perfectly reasonable rule.
  const weeks = Math.max(spanDays / 7, 1);
  const perWeek = Math.round((matched / weeks) * 10) / 10;

  return {
    matched,
    scanned: corpus.length,
    agreed,
    disagreed,
    falseAdmits,
    perWeek,
    samples,
  };
}

export interface RuleJudgement {
  /** May this rule be offered to the owner at all? */
  offerable: boolean;
  /** Why not, in the owner's language. Empty when offerable. */
  refusals: string[];
  /** Non-fatal things worth saying on the approval screen. */
  warnings: string[];
}

/**
 * Should this rule ever reach the approval screen?
 *
 * Auto-REFUSAL, not auto-approval. Nothing here can activate a rule; it can
 * only stop a bad one being offered, which is the asymmetry the whole design
 * depends on.
 */
export function judgeBacktest(
  rule: Pick<MailRule, 'action'>,
  backtest: MailRuleBacktest,
  decisionCount: number,
): RuleJudgement {
  const refusals: string[] = [];
  const warnings: string[] = [];

  if (backtest.matched === 0) {
    refusals.push('It matches nothing in the mailbox, so there is nothing to approve.');
  }

  if (rule.action === 'admit') {
    const share = backtest.scanned ? backtest.matched / backtest.scanned : 0;
    if (share > MAX_ADMIT_SHARE) {
      refusals.push(
        `It would admit ${Math.round(share * 100)}% of the mailbox (${backtest.matched} of ${backtest.scanned}). ` +
          'A rule that broad is the old behaviour under a new name.',
      );
    }
    if (backtest.perWeek > MAX_ADMITS_PER_WEEK) {
      refusals.push(`It would admit about ${backtest.perWeek} threads a week, over the ${MAX_ADMITS_PER_WEEK} limit.`);
    }
    if (backtest.falseAdmits > MAX_FALSE_ADMITS) {
      refusals.push(
        `It would re-admit ${backtest.falseAdmits} threads you had already rejected. That is the failure this gate exists to catch.`,
      );
    } else if (backtest.falseAdmits > 0) {
      warnings.push(`It would re-admit ${backtest.falseAdmits} thread(s) you rejected — worth reading the samples.`);
    }
  }

  // Not a refusal. A rule proposed before the owner has decided much is
  // untested rather than wrong, and saying so is more useful than blocking it.
  if (decisionCount < 20) {
    warnings.push(
      `Only ${decisionCount} of your own decisions to check against, so the agreement figures are weak evidence.`,
    );
  }
  if (backtest.disagreed > backtest.agreed && backtest.agreed + backtest.disagreed > 0) {
    warnings.push(
      `It disagrees with you more often than it agrees (${backtest.disagreed} vs ${backtest.agreed}).`,
    );
  }

  return { offerable: refusals.length === 0, refusals, warnings };
}
