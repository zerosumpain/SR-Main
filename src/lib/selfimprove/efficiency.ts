// src/lib/selfimprove/efficiency.ts
//
// The prime outcome: how many tool calls it takes to answer one question.
//
// Everything else the engine does (build a tool, repair a tool, register an
// API) adds capability. This measures the cost of USING it, and is the only
// metric a nightly run is graded against. The measurement itself lives in
// $lib/server/hermes-sessions (`getCallEfficiency`) because the turn data is in
// homeserv's Hermes SQLite; this module owns the engine-side concerns —
// snapshotting, persistence for the ledger, and deciding whether a live policy
// change earned its place or must be rolled back.
//
// The headline number is the CHAT segment. Agentic turns (browser, terminal,
// delegation) are measured and reported but never optimised against: their step
// count is a property of the task, and driving it down would mean discouraging
// thorough work (owner decision, 2026-07-29).

import { upsertRecord } from '$lib/datastore';
import type { CallEfficiency } from '$lib/server/hermes-sessions';
import {
  getActivePolicy,
  revertPolicyTo,
  updatePolicyTrial,
  type EfficiencySnapshot,
  type ToolPolicyVersion,
} from '$lib/toolpolicy/policy';
import { COLLECTIONS, SYSTEM_ACTOR, TRIAL, asData, errMsg, type RunAction } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Read the metric. Returns null (never throws) when Hermes is unreachable —
 *  a missing measurement must skip the phase, not fail the run. */
export async function measureEfficiency(days: number = TRIAL.windowDays): Promise<CallEfficiency | null> {
  try {
    const { rCallEfficiency } = await import('$lib/server/hermes-remote');
    return await rCallEfficiency(days);
  } catch (err) {
    console.error('[selfimprove] call-efficiency measurement failed:', errMsg(err));
    return null;
  }
}

/** Reduce a full measurement to the three numbers a trial is judged on. */
export function snapshotOf(eff: CallEfficiency): EfficiencySnapshot {
  return {
    meanCalls: eff.chat.meanCalls,
    turns: eff.chat.turns,
    repeatCalls: eff.chat.repeatCalls,
    takenAt: eff.generatedAt,
  };
}

/**
 * Persist the measurement for the ledger: a `metric:latest` pointer plus one
 * dated record per run, so the page can chart the trend. Mirrors how
 * question_insights keeps `latest` + `weekly:<key>`.
 *
 * Stored in the tool-policy collection because that is where the thing being
 * measured lives; `listPolicyVersions` filters on the `v:` prefix, so these
 * `metric:` keys never appear as versions.
 */
export async function persistMeasurement(eff: CallEfficiency): Promise<void> {
  const day = eff.generatedAt.slice(0, 10);
  const payload = asData({
    days: eff.days,
    chat: eff.chat,
    agentic: eff.agentic,
    all: eff.all,
    discoveryCalls: eff.discoveryCalls,
    patterns: eff.patterns,
    generatedAt: eff.generatedAt,
  });
  for (const key of ['metric:latest', `metric:${day}`]) {
    try {
      await upsertRecord(COLLECTIONS.toolPolicy, { key, data: payload }, SYSTEM_ACTOR);
    } catch (err) {
      console.error(`[selfimprove] persist ${key} failed:`, errMsg(err));
    }
  }
}

export type TrialDecision =
  | { kind: 'none' }
  | { kind: 'waiting'; turnsObserved: number; needed: number; ageDays: number }
  | { kind: 'kept'; version: number; before: number; after: number }
  | { kind: 'reverted'; version: number; revertedTo: number; before: number; after: number };

/** Is this trial old enough / big enough to judge? */
export function trialIsDecidable(
  turnsObserved: number,
  ageDays: number,
): boolean {
  return turnsObserved >= TRIAL.minTurns || ageDays >= TRIAL.maxDays;
}

/**
 * Did the change earn its place? Keep only on a real drop in mean calls per
 * chat turn; a neutral result reverts, because the overlay costs prompt tokens
 * on every single turn and "made no difference" does not pay for that.
 */
export function trialImproved(before: number, after: number): boolean {
  if (before <= 0) return false;
  return after <= before * (1 - TRIAL.minImprovement);
}

/**
 * Assess the trial on the live policy and act on it.
 *
 * The window is measured from the trial's start rather than a fixed 30 days, so
 * the "after" number contains no turns from before the change — comparing a
 * trailing 30-day mean against its own baseline would dilute the effect with
 * the very turns the baseline was made of.
 */
export async function assessActiveTrial(): Promise<{ decision: TrialDecision; actions: RunAction[] }> {
  const actions: RunAction[] = [];
  const policy = await getActivePolicy();

  if (!policy.trial || policy.trial.status !== 'running') {
    return { decision: { kind: 'none' }, actions };
  }

  const startedAt = new Date(policy.trial.startedAt).getTime();
  const ageDays = Math.max(0, (Date.now() - startedAt) / DAY_MS);
  // At least 1 day of window — a trial published hours ago has nothing to read.
  const windowDays = Math.max(1, Math.ceil(ageDays));

  const since = await measureEfficiency(windowDays);
  if (!since) {
    return { decision: { kind: 'none' }, actions };
  }

  const turnsObserved = since.chat.turns;
  await updatePolicyTrial(policy.version, { ...policy.trial, turnsObserved });

  if (!trialIsDecidable(turnsObserved, ageDays)) {
    return {
      decision: {
        kind: 'waiting',
        turnsObserved,
        needed: TRIAL.minTurns,
        ageDays: Number(ageDays.toFixed(1)),
      },
      actions,
    };
  }

  const before = policy.trial.baseline.meanCalls;
  const after = since.chat.meanCalls;
  const result = snapshotOf(since);
  const pct = before > 0 ? ((after - before) / before) * 100 : 0;
  const movement = `${before.toFixed(2)} → ${after.toFixed(2)} calls/turn (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%) over ${turnsObserved} turns`;

  if (trialImproved(before, after)) {
    await updatePolicyTrial(policy.version, {
      ...policy.trial,
      status: 'kept',
      turnsObserved,
      result,
      verdict: `Kept: ${movement}`,
      decidedAt: new Date().toISOString(),
    });
    actions.push({ kind: 'policy_kept', detail: `v${policy.version} kept — ${movement}` });
    return { decision: { kind: 'kept', version: policy.version, before, after }, actions };
  }

  // Rolled back. The parent is the state this version replaced; a null parent
  // means it was the first overlay, so the rollback target is the base policy.
  const target = policy.parentVersion ?? 0;
  await updatePolicyTrial(policy.version, {
    ...policy.trial,
    status: 'reverted',
    turnsObserved,
    result,
    verdict: `Reverted: ${movement}`,
    decidedAt: new Date().toISOString(),
  });
  try {
    await revertPolicyTo(target, movement, 'engine');
  } catch (err) {
    console.error('[selfimprove] policy revert failed:', errMsg(err));
    return { decision: { kind: 'none' }, actions };
  }
  actions.push({
    kind: 'policy_reverted',
    detail: `v${policy.version} rolled back to v${target} — ${movement}`,
  });
  return {
    decision: { kind: 'reverted', version: policy.version, revertedTo: target, before, after },
    actions,
  };
}

/** Human-readable one-liner for the report + WhatsApp summary. */
export function formatEfficiency(eff: CallEfficiency): string {
  return (
    `${eff.chat.meanCalls} calls/chat turn (median ${eff.chat.medianCalls}, p90 ${eff.chat.p90Calls}) ` +
    `over ${eff.chat.turns} turns; ${eff.chat.repeatCalls} repeat + ${eff.chat.duplicateCalls} duplicate calls. ` +
    `Agentic: ${eff.agentic.meanCalls} over ${eff.agentic.turns} turns.`
  );
}

/** The policy currently live — re-exported so the phase doesn't import two modules. */
export async function activePolicy(): Promise<ToolPolicyVersion> {
  return getActivePolicy();
}
