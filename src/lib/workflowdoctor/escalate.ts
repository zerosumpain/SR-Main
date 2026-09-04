// src/lib/workflowdoctor/escalate.ts
//
// The wire that folds the doctor into self-improvement.
//
// ── Why this shape ──────────────────────────────────────────────────────────
//
// The obvious wiring — have `selfimprove/analyze.ts` read doctor findings the
// way it reads the fault ledger — is not available: `$lib/workflowdoctor`
// already imports `$lib/selfimprove` (the budget shape, the idle gate), so an
// import back would close a cycle in front of `check-module-boundaries`.
//
// The better answer was there anyway. `daydream_faults` is ALREADY the door
// every gap comes through, and self-improve already reads it first. So a
// doctor finding it cannot fix becomes an ordinary fault, and the two engines
// stop being two: one ledger of what is broken, one queue of what to do about
// it, one room that shows both.
//
// ── What escalates, and what deliberately does not ──────────────────────────
//
// A finding only becomes a fault when a human writing code is genuinely the
// remedy. The doctor's own lanes come first and are not duplicated here:
// AUTO_APPLY_KINDS are config edits it can make itself, and the circuit
// breaker already stops a runaway schedule. And a finding whose fix is "go and
// pay the bill" or "reconnect the account" is not a code change — raising it
// would fill the ledger with work nothing in the loop can ever close, which is
// the noise `collectStarvation` learned to refuse.

import { raiseFault } from '$lib/daydream/faults';
import { AUTO_APPLY_KINDS, errMsg, type DoctorFindingData, type FixKind } from './types';

/**
 * Fixes that need a person with a card, an account or a password. Real, and
 * already on `/jkai/daydreams/improvement` as findings — but not buildable, so
 * they never enter the fault ledger.
 */
const HUMAN_ONLY: ReadonlyArray<FixKind> = [
  'missing-credential',
  'provider-limit',
  'expired-oauth',
  'permission-denied',
];

/**
 * How many nights a finding must persist before it is escalated.
 *
 * One occurrence is a bad afternoon. The doctor triages a 7-day window that
 * overlaps every night, so a genuine standing defect accumulates; a transient
 * one does not. Three is the same bar `collectFaultIdeas` uses to call a fault
 * priority 1.
 */
export const ESCALATE_AFTER = 3;

export interface EscalationInput {
  workflowId: string;
  workflowName: string;
  nodeId: string | null;
  nodeType: string | null;
  nodeLabel: string | null;
  fixKind: FixKind;
  occurrences: number;
  symptom: string;
  cause: string;
  fix: string;
}

/** Should this finding become a fault? PURE, so the rule is testable without
 *  a database and cannot drift into the writer. */
export function shouldEscalate(f: Pick<EscalationInput, 'fixKind' | 'occurrences'>): boolean {
  if (f.fixKind === 'dead-node-type') return true; // static defect; it can never run
  if (AUTO_APPLY_KINDS.includes(f.fixKind)) return false; // the doctor's own lane
  if (f.fixKind === 'runaway-schedule') return false; // the breaker's lane
  if (HUMAN_ONLY.includes(f.fixKind)) return false;
  return f.occurrences >= ESCALATE_AFTER;
}

/** The fault's identity. Stable across nights, and readable in the ledger. */
export function escalationIdentifier(f: Pick<EscalationInput, 'workflowName' | 'nodeType' | 'nodeLabel' | 'fixKind'>): string {
  const where = f.nodeLabel ?? f.nodeType ?? 'the run';
  return `${f.workflowName} / ${where} (${f.fixKind})`;
}

/**
 * Raise a fault for every finding a human has to write code for. Soft — the
 * doctor's night must not fail because the ledger was unwritable.
 *
 * Returns the identifiers raised, for the run record and the pulse: a silent
 * escalation is indistinguishable from none, and this is the step that decides
 * what self-improvement works on tomorrow night.
 */
export async function escalateFindings(findings: EscalationInput[]): Promise<string[]> {
  const raised: string[] = [];
  for (const f of findings) {
    if (!shouldEscalate(f)) continue;
    const identifier = escalationIdentifier(f);
    try {
      await raiseFault({
        kind: f.fixKind === 'dead-node-type' ? 'workflow_dead_node' : 'workflow_failing',
        identifier,
        site: 'workflow-doctor',
        detail: `${f.symptom} ${f.cause} Suggested fix: ${f.fix}`.slice(0, 1000),
      });
      raised.push(identifier);
    } catch (err) {
      console.warn(`[workflowdoctor] escalation failed for ${identifier}: ${errMsg(err)}`);
    }
  }
  return raised;
}

/** Narrow a persisted finding to what escalation needs. */
export function toEscalationInput(f: DoctorFindingData): EscalationInput {
  return {
    workflowId: f.workflowId,
    workflowName: f.workflowName,
    nodeId: f.nodeId,
    nodeType: f.nodeType,
    nodeLabel: f.nodeLabel,
    fixKind: f.fixKind,
    occurrences: f.occurrences,
    symptom: f.symptom,
    cause: f.cause,
    fix: f.fix,
  };
}
