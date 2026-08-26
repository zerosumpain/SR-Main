// src/lib/daydream/rules/store.ts
//
// The lifecycle of a proposed rule: proposed → active → deprecated, or
// proposed → rejected.
//
// Only the owner moves anything to `active`. That is the deliberate difference
// from the self-improvement engine, which auto-enables the tools it builds:
// a tool nobody is interrupted by can prove itself in production, and a rule
// that buzzes a phone cannot.

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamRules, daydreamThoughts } from '$lib/db/schema';
import { validateRuleSpec, type RuleSpec, type RuleStatus } from './spec';
import { backtestRule, type BacktestResult } from './backtest';
import { errMsg } from '../types';

export interface StoredRule {
  id: string;
  kind: string;
  spec: RuleSpec;
  status: RuleStatus;
  rationale: string;
  proposalKind: string;
  supersedesId: string | null;
  backtestFires: number | null;
  backtestDays: number | null;
  backtestLowerBound: boolean;
  backtestNote: string | null;
  firedCount: number;
  usefulCount: number;
  notUsefulCount: number;
  createdAt: string;
  decidedAt: string | null;
}

function toStored(r: typeof daydreamRules.$inferSelect): StoredRule {
  return {
    id: r.id,
    kind: r.kind,
    spec: r.spec as unknown as RuleSpec,
    status: r.status as RuleStatus,
    rationale: r.rationale,
    proposalKind: r.proposalKind,
    supersedesId: r.supersedesId,
    backtestFires: r.backtestFires,
    backtestDays: r.backtestDays,
    backtestLowerBound: r.backtestLowerBound,
    backtestNote: r.backtestNote,
    firedCount: r.firedCount,
    usefulCount: r.usefulCount,
    notUsefulCount: r.notUsefulCount,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
  };
}

/** Rules that may fire. */
export async function listActiveRules(): Promise<StoredRule[]> {
  const rows = await db.select().from(daydreamRules).where(eq(daydreamRules.status, 'active'));
  return rows.map(toStored);
}

export async function listRules(statuses?: RuleStatus[]): Promise<StoredRule[]> {
  const rows = statuses?.length
    ? await db.select().from(daydreamRules).where(inArray(daydreamRules.status, statuses)).orderBy(desc(daydreamRules.createdAt))
    : await db.select().from(daydreamRules).orderBy(desc(daydreamRules.createdAt));
  return rows.map(toStored);
}

export interface AdmitResult {
  admitted: boolean;
  reason: string;
  ruleId: string | null;
  backtest: BacktestResult | null;
}

/**
 * Put a proposal through the gates.
 *
 * Three of them, in cost order: structural validation (free), backtest
 * (a query), and then the owner (a person's attention, the scarcest of the
 * three). Anything that fails a cheaper gate never reaches a dearer one.
 *
 * Note what this does NOT do: activate anything.
 */
export async function admitProposal(
  raw: unknown,
  opts: { proposalKind?: string; supersedesId?: string | null; backtestDays?: number } = {},
): Promise<AdmitResult> {
  const validation = validateRuleSpec(raw);
  if (!validation.ok) {
    return {
      admitted: false,
      reason: `invalid: ${validation.errors.join('; ')}`,
      ruleId: null,
      backtest: null,
    };
  }
  const spec = raw as RuleSpec;

  // A kind is the mute key and the weight key as well as the identifier, so a
  // collision would silently inherit another rule's learned history.
  const [clash] = await db
    .select({ id: daydreamRules.id, status: daydreamRules.status })
    .from(daydreamRules)
    .where(eq(daydreamRules.kind, spec.kind))
    .limit(1);
  if (clash) {
    return {
      admitted: false,
      reason: `a rule already exists with kind "${spec.kind}" (${clash.status})`,
      ruleId: null,
      backtest: null,
    };
  }

  let backtest: BacktestResult;
  try {
    backtest = await backtestRule(spec, { days: opts.backtestDays ?? 30 });
  } catch (err) {
    return { admitted: false, reason: `backtest failed: ${errMsg(err)}`, ruleId: null, backtest: null };
  }

  if (backtest.tooNoisy) {
    // Refused without anyone reading it. A rule firing this often is noise
    // whatever it claims to detect, and a lower-bound estimate that is already
    // too noisy can only get worse.
    return {
      admitted: false,
      reason: `too noisy: ${backtest.note}`,
      ruleId: null,
      backtest,
    };
  }

  const [row] = await db
    .insert(daydreamRules)
    .values({
      kind: spec.kind,
      spec: spec as unknown as Record<string, unknown>,
      status: 'proposed',
      rationale: spec.rationale,
      proposalKind: opts.proposalKind ?? 'new',
      supersedesId: opts.supersedesId ?? null,
      backtestFires: backtest.fires,
      backtestDays: backtest.days,
      backtestLowerBound: backtest.lowerBound,
      backtestNote: backtest.note,
    })
    .returning({ id: daydreamRules.id });

  return { admitted: true, reason: 'awaiting your decision', ruleId: row.id, backtest };
}

/** The owner's verdict. The only path to `active`. */
export async function decideRule(
  ruleId: string,
  decision: 'approve' | 'reject' | 'deprecate',
): Promise<{ kind: string; status: RuleStatus }> {
  const status: RuleStatus =
    decision === 'approve' ? 'active' : decision === 'reject' ? 'rejected' : 'deprecated';

  const [row] = await db
    .update(daydreamRules)
    .set({ status, decidedAt: new Date(), decidedBy: 'owner', updatedAt: new Date() })
    .where(eq(daydreamRules.id, ruleId))
    .returning({ kind: daydreamRules.kind });
  if (!row) throw new Error(`no such rule: ${ruleId}`);

  // Approving a tweak retires what it replaces, so two versions of the same
  // idea cannot both fire.
  if (decision === 'approve') {
    const [rule] = await db
      .select({ supersedesId: daydreamRules.supersedesId })
      .from(daydreamRules)
      .where(eq(daydreamRules.id, ruleId))
      .limit(1);
    if (rule?.supersedesId) {
      await db
        .update(daydreamRules)
        .set({ status: 'deprecated', updatedAt: new Date() })
        .where(eq(daydreamRules.id, rule.supersedesId));
    }
  }

  return { kind: row.kind, status };
}

/**
 * Refresh what each rule has actually done, from the ledger.
 *
 * Derived rather than incremented: a counter that is bumped at fire time drifts
 * the first time a run half-fails, and there is no way to notice. Counting the
 * rows is a query.
 */
export async function refreshRuleOutcomes(): Promise<number> {
  const rules = await db.select({ id: daydreamRules.id, kind: daydreamRules.kind }).from(daydreamRules);
  let updated = 0;
  for (const rule of rules) {
    const [counts] = await db
      .select({
        fired: sql<number>`count(*)::int`,
        useful: sql<number>`count(*) filter (where ${daydreamThoughts.feedback} = 'useful')::int`,
        notUseful: sql<number>`count(*) filter (where ${daydreamThoughts.feedback} = 'not_useful')::int`,
      })
      .from(daydreamThoughts)
      .where(eq(daydreamThoughts.kind, rule.kind));

    await db
      .update(daydreamRules)
      .set({
        firedCount: counts?.fired ?? 0,
        usefulCount: counts?.useful ?? 0,
        notUsefulCount: counts?.notUseful ?? 0,
        updatedAt: new Date(),
      })
      .where(eq(daydreamRules.id, rule.id));
    updated++;
  }
  return updated;
}

/**
 * Rules worth retiring, by their own record.
 *
 * Offered to the model as candidates for a deprecation proposal rather than
 * retired automatically: a rule that has fired ten times and been rejected
 * every time is probably bad, but "probably" is not a reason to delete
 * something the owner approved.
 */
export async function retirementCandidates(): Promise<StoredRule[]> {
  const active = await listActiveRules();
  return active.filter(
    (r) =>
      (r.firedCount >= 5 && r.usefulCount === 0 && r.notUsefulCount >= 3) ||
      (r.firedCount >= 20 && r.usefulCount === 0),
  );
}
