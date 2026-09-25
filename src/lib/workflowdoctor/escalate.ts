// src/lib/workflowdoctor/escalate.ts
//
// The wire that folds the doctor into self-improvement.
//
// ── Why this shape ──────────────────────────────────────────────────────────
//
// A doctor finding a human must write code for becomes a `feature` idea in
// the self-improvement backlog, stamped with the `doctor` intake channel.
// `$lib/workflowdoctor` already imports `$lib/selfimprove` (the idle gate), so
// this is the existing direction, not a new edge.
//
// It used to go the long way round: an ordinary `daydream_faults` row, which
// self-improve then read back out as an idea. That ledger was deleted with the
// daydream engine in P4a (2026-09-25, spec D3), and the doctor now queues
// directly — one queue, the same `Fix …` title the fault fold produced.
//
// ── What escalates, and what deliberately does not ──────────────────────────
//
// A finding only becomes a fault when a human writing code is genuinely the
// remedy. The doctor's own lanes come first and are not duplicated here:
// AUTO_APPLY_KINDS are config edits it can make itself, and the circuit
// breaker already stops a runaway schedule. And a finding whose fix is "go and
// pay the bill" or "reconnect the account" is not a code change — raising it
// would fill the backlog with work nothing in the loop can ever close.

import { addIdeas } from '$lib/selfimprove/backlog';
import { slugifyIdea } from '$lib/selfimprove/types';
import { AUTO_APPLY_KINDS, errMsg, type DoctorFindingData, type FixKind } from './types';

/**
 * Fixes that need a person with a card, an account or a password. Real, and
 * already on `/jkai/daydreams/doctor` as findings — but not buildable, so
 * they never enter the backlog.
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
 * one does not. Three is also the bar for queueing it at priority 1.
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

/** Should this finding become backlog work? PURE, so the rule is testable without
 *  a database and cannot drift into the writer. */
export function shouldEscalate(f: Pick<EscalationInput, 'fixKind' | 'occurrences'>): boolean {
  if (f.fixKind === 'dead-node-type') return true; // static defect; it can never run
  if (AUTO_APPLY_KINDS.includes(f.fixKind)) return false; // the doctor's own lane
  if (f.fixKind === 'runaway-schedule') return false; // the breaker's lane
  if (HUMAN_ONLY.includes(f.fixKind)) return false;
  return f.occurrences >= ESCALATE_AFTER;
}

/** The finding's identity. Stable across nights, and readable in the backlog. */
export function escalationIdentifier(f: Pick<EscalationInput, 'workflowName' | 'nodeType' | 'nodeLabel' | 'fixKind'>): string {
  const where = f.nodeLabel ?? f.nodeType ?? 'the run';
  return `${f.workflowName} / ${where} (${f.fixKind})`;
}

/** The backlog title for a finding — the `Fix …` shape the fault fold used,
 *  so a finding queued before and after P4a slugs to the same item. */
export function escalationTitle(identifier: string): string {
  return `Fix ${identifier}`.slice(0, 200);
}

/**
 * Queue every finding a human has to write code for as a backlog `feature`.
 * Soft — the doctor's night must not fail because the backlog was unwritable.
 *
 * Returns the identifiers NEWLY queued, for the run record and the pulse. An
 * item already in the backlog keeps its history (`addIdeas` never rewrites an
 * existing slug), so a standing defect is queued once, not every night.
 */
export async function escalateFindings(findings: EscalationInput[]): Promise<string[]> {
  const wanted = findings.filter(shouldEscalate).map((f) => {
    const identifier = escalationIdentifier(f);
    return {
      identifier,
      idea: {
        title: escalationTitle(identifier),
        detail: `${f.symptom} ${f.cause} Suggested fix: ${f.fix} (seen ${f.occurrences} time${f.occurrences === 1 ? '' : 's'} by the workflow doctor).`.slice(0, 2000),
        kind: 'feature' as const,
        priority: f.occurrences >= ESCALATE_AFTER ? 1 : 2,
        source: 'doctor' as const,
      },
    };
  });
  if (wanted.length === 0) return [];
  try {
    const created = new Set(await addIdeas(wanted.map((w) => w.idea)));
    return wanted.filter((w) => created.has(slugifyIdea(w.idea.title))).map((w) => w.identifier);
  } catch (err) {
    console.warn(`[workflowdoctor] escalation to the backlog failed: ${errMsg(err)}`);
    return [];
  }
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
