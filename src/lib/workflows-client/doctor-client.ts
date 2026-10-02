// The workflow doctor, as Main sees it since the doctor moved to SR-Workflows
// (2026-10-02): a client of the authenticated runtime contract, plus the wire
// types the owner page renders.
//
// SR-Workflows owns the engine — the nightly run in its worker, triage,
// lint, diagnosis, the circuit breaker, auto-apply, the advisory lock,
// stale-finding resolution, escalation — and every table it reads or mutates.
// Main keeps no doctor logic: `/jkai/develop/doctor` asks for `doctor_overview`
// and strips it for a member, and `/api/admin/doctor/*` forward the owner's
// controls. Like every runtime call, a lost answer is never retried here.
//
// The types mirror SR-Workflows `src/lib/workflowdoctor/{types,narrative,
// finding-view,triage,overview}.ts`. They are the contract, not a second copy
// of the logic; change them together with the owner.

import { invokeWorkflowRuntime } from './runtime-client';

// ── Run records (`doctor_runs`) ─────────────────────────────────────────────

export type PhaseName = 'gather' | 'lint' | 'diagnose' | 'fix' | 'verify' | 'propose' | 'report';
export type PhaseStatus = 'ok' | 'failed' | 'skipped';
export type RunStatus = 'running' | 'complete' | 'partial' | 'budget_exceeded' | 'aborted_user_active' | 'failed';

export interface PhaseRecord {
  status: PhaseStatus;
  detail?: string;
  ms?: number;
}

export type FixKind =
  | 'dead-node-type'
  | 'runaway-schedule'
  | 'unknown-config-key'
  | 'enum-violation'
  | 'broken-input-ref'
  | 'empty-required-field'
  | 'unsupported-template-syntax'
  | 'missing-credential'
  | 'provider-limit'
  | 'expired-oauth'
  | 'permission-denied'
  | 'secret-in-node-config'
  | 'unclassified';

export type FindingStatus = 'proposed' | 'auto_fixed' | 'reverted' | 'refused_sensitive' | 'accepted' | 'dismissed' | 'resolved';

export interface DoctorStory {
  subject: string;
  symptom: string;
  symptomEvidence?: string;
  occurrences?: number;
  cause: string;
  causeSource: 'signature' | 'linter' | 'llm';
  fix: string;
  fixMode: 'auto-apply' | 'propose-only' | 'refused';
  outcome: string;
  outcomeKind: 'measured' | 'expected' | 'unproven';
}

export interface DoctorAction {
  kind: string;
  detail: string;
  story?: DoctorStory;
}

export interface DoctorRunData {
  status: RunStatus;
  trigger: 'cron' | 'manual';
  startedAt: string;
  finishedAt?: string;
  phases: Record<PhaseName, PhaseRecord>;
  llmCalls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  workflowsFailing: number;
  signaturesSeen: number;
  autoApplyEnabled: boolean;
  breakerEnabled: boolean;
  fixesApplied: number;
  fixesReverted: number;
  fixesRefusedSensitive: number;
  schedulesQuarantined: number;
  proposalsOpened: number;
  findingsResolved: number;
  whatsappDelivered: boolean;
  actions: DoctorAction[];
  report: string;
}

export interface NarrativeRun {
  runId: string;
  createdAt: string;
  data: DoctorRunData;
}

// ── The owner page ──────────────────────────────────────────────────────────

export interface StoryStep {
  at: string;
  label: string;
}

export interface DoctorStoryCard extends DoctorStory {
  id: string;
  status: FindingStatus;
  statusLabel: string;
  fixKind: FixKind;
  fixKindLabel: string;
  workflowId: string;
  workflowName: string;
  canvasSlug: string | null;
  nodeId: string | null;
  note?: string;
  sensitiveFields?: string[];
  arc: StoryStep[];
  firstSeen: string;
  lastSeen: string;
  updatedAt: string;
}

/** A finding as the owner's controls may know it: field NAMES, never values. */
export interface FindingView {
  key: string;
  workflowId: string;
  workflowName: string;
  canvasSlug: string | null;
  nodeId: string | null;
  nodeType: string | null;
  nodeLabel: string | null;
  fixKind: FixKind;
  fixKindLabel: string;
  status: FindingStatus;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  updatedAt: string;
  symptom: string;
  cause: string;
  causeSource: 'signature' | 'linter' | 'llm';
  fix: string;
  sensitiveFields?: string[];
  revertKind: 'node' | 'schedule' | null;
  changedFields: string[];
  verifyBefore?: number;
  verifyAfter?: number;
}

export interface TriageSignature {
  workflowId: string;
  workflowName: string;
  canvasSlug: string | null;
  level: 'run' | 'node';
  nodeId: string | null;
  nodeType: string | null;
  nodeLabel: string | null;
  signature: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  lastRunId: string;
  actionable: boolean;
  examples: string[];
}

export interface SilentFailure {
  runId: string;
  workflowId: string;
  workflowName: string;
  canvasSlug: string | null;
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  httpStatus: number | null;
  errorText: string | null;
  at: string;
}

export interface RunawaySchedule {
  scheduleId: string;
  workflowId: string;
  workflowName: string;
  canvasSlug: string | null;
  cronExpr: string;
  consecutiveFailures: number;
  signature: string;
  wastedRuns: number;
}

export interface DeadNodeType {
  workflowId: string;
  workflowName: string;
  canvasSlug: string | null;
  nodeId: string;
  nodeLabel: string;
  deadType: string;
  candidate: string | null;
  candidateConfidence: number;
}

/** SR-Workflows' `buildDoctorOverview()`: the owner's page, before Main strips it for a member. */
export interface DoctorOverview {
  runs: NarrativeRun[];
  stories: DoctorStoryCard[];
  storySummary: string;
  prime: {
    workflowsFailing: number;
    liveFigure: boolean;
    fixedLastNight: number;
    quarantinedLastNight: number;
    openProposals: number;
    refused: number;
    stillFailingAfterFix: number;
    nightsSinceClean: number | null;
    spark: Array<{ day: string; failing: number }>;
  };
  stats: {
    totalRuns: number;
    lastRunAt: string | null;
    openFindings: number;
    byStatus: Partial<Record<FindingStatus, number>>;
    fixesApplied: number;
    fixesReverted: number;
    schedulesQuarantined: number;
    llmCalls: number;
    costUsd: number;
  };
  lastRun: {
    runId: string;
    createdAt: string;
    status: RunStatus;
    trigger: 'cron' | 'manual';
    whatsappDelivered: boolean;
    autoApplyEnabled: boolean;
    breakerEnabled: boolean;
  } | null;
  signatures: TriageSignature[];
  silent: SilentFailure[];
  runaways: RunawaySchedule[];
  deadNodeTypes: DeadNodeType[];
  liveFailed: boolean;
  switches: { enabled: boolean; autoApply: boolean; breaker: boolean };
  lookbackDays: number;
  schedule: { expr: string; tz: string; display: string; armed: boolean };
  running: boolean;
  queuedRunId: string | null;
  controls: {
    caps: { breakerFailures: number; workflows: number; fixes: number; quietHours: number };
    findings: FindingView[];
  };
}

// ── Calls ───────────────────────────────────────────────────────────────────

/** An owner operation's answer, status code included, for the route to relay. */
export interface DoctorOpResult {
  status: number;
  body: Record<string, unknown>;
}

export function doctorOverview(): Promise<DoctorOverview> {
  return invokeWorkflowRuntime<DoctorOverview>({ action: 'doctor_overview' });
}

/** Queue a manual run on the Workflows worker. */
export function requestDoctorRun(): Promise<DoctorOpResult> {
  return invokeWorkflowRuntime<DoctorOpResult>({ action: 'doctor_run' });
}

/** Values pass through unchecked: the owner validates, so a wrong type is its 400. */
export function setDoctorSwitches(body: { enabled?: unknown; autoApply?: unknown; breaker?: unknown }): Promise<DoctorOpResult> {
  return invokeWorkflowRuntime<DoctorOpResult>({
    action: 'doctor_toggle',
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(body.autoApply !== undefined ? { autoApply: body.autoApply } : {}),
    ...(body.breaker !== undefined ? { breaker: body.breaker } : {}),
  });
}

export function actOnDoctorFinding(key: string, action: string): Promise<DoctorOpResult> {
  return invokeWorkflowRuntime<DoctorOpResult>({ action: 'doctor_finding', key, doctorAction: action });
}
