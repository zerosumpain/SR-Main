// src/lib/workflowdoctor/escalate.ts
//
// The wire that folds the doctor into self-improvement.
//
// ── Why this shape ──────────────────────────────────────────────────────────
//
// A doctor finding the doctor cannot fix itself is work for a person writing
// code, and since D3 (spec 2026-09-25) there is ONE queue for that: the
// improvement backlog. Escalation writes a `feature` item there directly,
// through `intakeIdeas` — the same door the think loop's build notes and the
// nightly question-miner use — so a finding raised night after night is one
// item with a growing citation, never a pile, and it reaches the repo builder
// only once the owner accepts its brief.
//
// It used to write a `daydream_faults` row that self-improvement read back the
// next night (`collectFaultIdeas`). That was a second ledger with its own
// dedup standing between the doctor and the queue; both were retired with D3.
// The direction is fine for the module boundaries: `$lib/selfimprove` never
// imports `$lib/workflowdoctor`.
//
// ── What escalates, and what deliberately does not ──────────────────────────
//
// A finding only becomes work when a human writing code is genuinely the
// remedy. The doctor's own lanes come first and are not duplicated here:
// AUTO_APPLY_KINDS are config edits it can make itself, and the circuit
// breaker already stops a runaway schedule. And a finding whose fix is "go and
// pay the bill" or "reconnect the account" is not a code change — queueing it
// would fill the backlog with work nothing in the loop can ever close.

import { intakeIdeas, type IdeaInput } from '$lib/selfimprove/backlog';
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
 * one does not. Three is also the bar at which an escalation is priority 1.
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

/** The finding's identity. Stable across nights, and readable on the board. */
export function escalationIdentifier(f: Pick<EscalationInput, 'workflowName' | 'nodeType' | 'nodeLabel' | 'fixKind'>): string {
  const where = f.nodeLabel ?? f.nodeType ?? 'the run';
  return `${f.workflowName} / ${where} (${f.fixKind})`;
}

/**
 * The backlog idea for one finding. PURE.
 *
 * The title is `Fix <identifier>` — the exact wording the retired fault feed
 * used — so an item already queued that way is found by its slug and cited,
 * not queued a second time.
 */
export function escalationIdea(f: EscalationInput): IdeaInput {
  const identifier = escalationIdentifier(f);
  return {
    title: `Fix ${identifier}`.slice(0, 200),
    detail: (
      `${f.symptom} ${f.cause} Suggested fix: ${f.fix} ` +
      `(Workflow doctor: seen on ${f.occurrences} run${f.occurrences === 1 ? '' : 's'} in its 7-day window.) ` +
      'This needs repo code — a node type migrated, a route, a schema change — so it goes to the repo builder as a change request once its brief is accepted.'
    ).slice(0, 2000),
    kind: 'feature',
    priority: f.fixKind === 'dead-node-type' || f.occurrences >= ESCALATE_AFTER ? 1 : 2,
    source: 'doctor',
    ref: `doctor:${f.workflowId}/${f.nodeId ?? 'run'}/${f.fixKind}`,
  };
}

/**
 * Queue backlog work for every finding a human has to write code for. Soft —
 * the doctor's night must not fail because the backlog was unwritable.
 *
 * Returns the identifiers escalated (queued new, or cited on the item already
 * queued for them), for the run record and the pulse: a silent escalation is
 * indistinguishable from none.
 */
export async function escalateFindings(findings: EscalationInput[]): Promise<string[]> {
  const due = findings.filter(shouldEscalate);
  if (due.length === 0) return [];
  const ideas = due.map(escalationIdea);
  try {
    const { outcomes } = await intakeIdeas(ideas);
    return due
      .filter((_, i) => outcomes[i] === 'added' || outcomes[i] === 'merged')
      .map(escalationIdentifier);
  } catch (err) {
    console.warn(`[workflowdoctor] escalation failed: ${errMsg(err)}`);
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
