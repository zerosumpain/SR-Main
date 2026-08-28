// Running the owner's approved rules over the queue.
//
// This is the "learns which emails to add automatically" half, and it is
// deliberately the smallest module in the feature: everything interesting
// already happened when the rule was backtested and approved. All that is left
// is to walk the pending threads, ask the rules, and do what they say.
//
// Two safeguards, both about blast radius rather than correctness:
//
//   - A per-run cap. A rule that is wrong in a way no backtest caught should
//     cost one night's mail, not the whole mailbox. The cap is small enough
//     that a mistake is visible in the queue the next morning and reversible
//     with `requeueMailNotes`.
//   - Rules never mark their own homework. Every decision is recorded with
//     `actor: 'rule'` and the rule's key, and the backtest reads only the
//     owner's own decisions — so a rule cannot make itself look right by
//     agreeing with the admissions it created.

import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { intelNotes } from '$lib/db/schema';
import { factsFor } from '../mail-facts';
import { admitMailNotes, rejectMailNotes } from '../mail-admit';
import { decide } from './evaluate';
import { activeMailRules } from './store';

/**
 * Threads one run may admit. Small on purpose — a rule's whole job is to save
 * the owner from a queue, not to empty it overnight, and every admission costs
 * a model call plus an embedding batch.
 */
export const MAX_AUTO_ADMIT_PER_RUN = 25;
/** Rejections are free and reversible, so they get more room. */
export const MAX_AUTO_REJECT_PER_RUN = 200;

export interface ApplyRulesResult {
  /** False when no rule is active — the normal state until the owner approves one. */
  ran: boolean;
  /** How many rules were switched on. Reported as a COUNT rather than only as
   *  `ran`, so the nightly run log — which stores numbers — can show the
   *  difference between "no rules yet" and "three rules, none matched". */
  activeRules: number;
  scanned: number;
  admitted: number;
  rejected: number;
  /** Threads a rule matched but the per-run cap deferred to tomorrow. */
  deferred: number;
  failed: number;
  byRule: Record<string, number>;
}

/**
 * Apply every active rule to the pending queue.
 *
 * Newest first, matching the sweep and the queue: if a cap defers work, the
 * mail deferred should be the oldest, not an arbitrary page.
 */
export async function applyMailRules(now = Date.now()): Promise<ApplyRulesResult> {
  const result: ApplyRulesResult = {
    ran: false,
    activeRules: 0,
    scanned: 0,
    admitted: 0,
    rejected: 0,
    deferred: 0,
    failed: 0,
    byRule: {},
  };

  const rules = await activeMailRules();
  if (!rules.length) return result;
  result.ran = true;
  result.activeRules = rules.length;

  const notes = await db
    .select({
      id: intelNotes.id,
      title: intelNotes.title,
      rawContent: intelNotes.rawContent,
      metadata: intelNotes.metadata,
      observedAt: intelNotes.observedAt,
      createdAt: intelNotes.createdAt,
    })
    .from(intelNotes)
    .where(and(eq(intelNotes.source, 'email'), eq(intelNotes.graphState, 'pending')))
    .orderBy(desc(sql`coalesce(${intelNotes.observedAt}, ${intelNotes.createdAt})`));

  const toAdmit: Array<{ id: string; ruleKey: string }> = [];
  const toReject: Array<{ id: string; ruleKey: string }> = [];

  for (const note of notes) {
    result.scanned++;
    const verdict = decide(rules, factsFor(note, now));
    if (!verdict.rule || !verdict.action) continue;
    const target = verdict.action === 'admit' ? toAdmit : toReject;
    const cap = verdict.action === 'admit' ? MAX_AUTO_ADMIT_PER_RUN : MAX_AUTO_REJECT_PER_RUN;
    if (target.length >= cap) {
      result.deferred++;
      continue;
    }
    target.push({ id: note.id, ruleKey: verdict.rule.key });
  }

  // Grouped by rule so each decision records which rule made it — a rule that
  // turns out to be wrong has to be findable by its own name, or undoing it
  // means undoing the night.
  const groups = (list: Array<{ id: string; ruleKey: string }>) => {
    const out = new Map<string, string[]>();
    for (const item of list) {
      const existing = out.get(item.ruleKey);
      if (existing) existing.push(item.id);
      else out.set(item.ruleKey, [item.id]);
    }
    return out;
  };

  for (const [ruleKey, ids] of groups(toReject)) {
    const rejected = await rejectMailNotes(ids, { actor: 'rule', ruleKey });
    result.rejected += rejected.rejected;
    result.byRule[ruleKey] = (result.byRule[ruleKey] ?? 0) + rejected.rejected;
  }

  for (const [ruleKey, ids] of groups(toAdmit)) {
    const admitted = await admitMailNotes(ids, { actor: 'rule', ruleKey });
    result.admitted += admitted.admitted;
    result.failed += admitted.failed;
    result.byRule[ruleKey] = (result.byRule[ruleKey] ?? 0) + admitted.admitted;
  }

  console.log(
    `[intel:mail-rules] ${rules.length} active rule(s) over ${result.scanned} pending — ` +
      `${result.admitted} admitted, ${result.rejected} rejected, ${result.deferred} deferred, ${result.failed} failed`,
  );
  return result;
}
