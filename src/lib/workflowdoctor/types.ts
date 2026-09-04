// src/lib/workflowdoctor/types.ts
//
// Shared constants + types for the nightly Workflow Doctor. Structurally a
// sibling of `src/lib/selfimprove/types.ts`, and it follows the same standing
// rule: the engine dogfoods the datastore for ALL of its state, so there are no
// dedicated tables, no `drizzle-kit push`, and no CI TTY-prompt risk.
//
// The doctor triages FAILED workflow runs, lints the persisted graph, explains
// each failure in plain English, and — inside a very narrow whitelist — repairs
// what it can. Everything it cannot safely repair becomes a proposal.

import type { PermissionSet } from '$lib/datastore';

/** Actor every workflow-doctor datastore write runs as. */
export const SYSTEM_ACTOR = 'system';

/** System collection slugs (pinned — renaming orphans every historical record). */
export const COLLECTIONS = {
  doctorRuns: 'doctor_runs',
  doctorFindings: 'doctor_findings',
} as const;

/**
 * Model for every doctor gateway call. Pinned rather than `resolveDefaultModel()`
 * so a change to the chat default cannot silently alter diagnosis quality
 * overnight — the same reasoning as SELFIMPROVE_MODEL.
 *
 * The FALLBACK, not the pin: `jkai.workflowdoctor.model` overrides it and is
 * settable from the model picker (the `doctor` entry in `$lib/models/workloads`).
 */
export { DEFAULT_DOCTOR_MODEL_ID as DOCTOR_MODEL } from '$lib/constants/default-models';

/**
 * app_settings kill switch. House semantics: unset/null is treated as ENABLED,
 * only an explicit `false` disables. Matches `selfimprove.enabled`.
 */
export const SETTINGS_ENABLED_KEY = 'workflowdoctor.enabled';

/**
 * Second kill switch, with DELIBERATELY INVERTED semantics: unset/null is
 * DISABLED, and only an explicit `true` permits an unattended write to
 * `workflow_nodes`. An unattended mutation path must never enable itself by
 * default. With this off the doctor still gathers, lints, diagnoses and
 * proposes — full value, zero blast radius on node config.
 */
export const SETTINGS_AUTOAPPLY_KEY = 'workflowdoctor.autoapply';

/**
 * Third switch, governing ONLY the runaway-schedule circuit breaker.
 *
 * Separate from `autoapply` and default-ON because the breaker is categorically
 * safer than a config edit: it flips one boolean (`workflow_schedules.enabled`)
 * on a table that holds no user data, touches no `workflow_nodes.config`, and
 * therefore cannot reach the audit-log credential-republish path at all. It is
 * also the single highest-value action available — a canvas whose node type no
 * longer exists failed 5,053 times on a five-minute cron before a human noticed.
 * Owner
 * decision, 2026-08-02: breaker on from night one, config edits shadow.
 */
export const SETTINGS_BREAKER_KEY = 'workflowdoctor.breaker';

// The nightly cron used to live here (`0 5 * * *`, Europe/London). The
// schedule is now the `daydream-doctor` heartbeat activity — see that handler
// for the window, and `$lib/heartbeat/activity-schedule.ts` for the accessor
// the two dashboards read. The constants are DELETED rather than kept as
// documentation, for the reason self-improve deleted its own on 2026-08-30:
// both pages were printing them as the live schedule, which is how a dashboard
// starts lying.

/** Advisory-lock lane so two app instances cannot both mutate the same canvas. */
export const DOCTOR_LOCK_LANE = 'jkai:workflow-doctor';

/** Skip a nightly run if the user chatted within this window (idle gate). */
export const IDLE_WINDOW_MS = 60 * 60 * 1000; // 60 min

/** Hard budget caps for one run. */
export const BUDGET_CAPS = {
  maxLlmCalls: 20,
  maxCostUsd: 0.25,
  maxWallMs: 20 * 60 * 1000, // 20 minutes wall clock
} as const;

/** Work caps, sized so a worst-case night stays well inside BUDGET_CAPS. */
export const WORK_CAPS = {
  /** Failure window. */
  lookbackDays: 7,
  /** A signature must recur this many times before it is worth acting on. */
  minOccurrences: 2,
  maxWorkflowsTriaged: 25,
  maxSignatures: 40,
  /** Signatures sent to the LLM after the deterministic table falls through. */
  maxDiagnoses: 8,
  maxWorkflowsMutated: 3,
  maxAutoFixesTotal: 5,
  maxNodeWritesPerWorkflow: 2,
  /** Never touch a workflow a human edited this recently. */
  humanEditQuietHours: 24,
  /** Leave this much wall-clock headroom for the report phase. */
  reserveWallMs: 60 * 1000,
  /**
   * Circuit breaker: consecutive failed runs, with zero successes in the
   * window, before an enabled cron schedule is quarantined. Deliberately low —
   * a schedule that has failed this many times in a row with no success in
   * between is not flaky, it is broken.
   */
  breakerConsecutiveFailures: 10,
  /** Never quarantine more than this many schedules in one night. */
  maxSchedulesQuarantined: 3,
} as const;

// ---------------------------------------------------------------------------
// Run record
// ---------------------------------------------------------------------------

export type PhaseName =
  | 'gather'
  | 'lint'
  | 'diagnose'
  | 'fix'
  | 'verify'
  | 'propose'
  | 'report';

export type PhaseStatus = 'ok' | 'failed' | 'skipped';

export type RunStatus =
  | 'running'
  | 'complete'
  | 'partial'
  | 'budget_exceeded'
  | 'aborted_user_active'
  | 'failed';

export interface PhaseRecord {
  status: PhaseStatus;
  detail?: string;
  ms?: number;
}

/** Fresh, all-skipped phase map. */
export function emptyPhases(): Record<PhaseName, PhaseRecord> {
  return {
    gather: { status: 'skipped' },
    lint: { status: 'skipped' },
    diagnose: { status: 'skipped' },
    fix: { status: 'skipped' },
    verify: { status: 'skipped' },
    propose: { status: 'skipped' },
    report: { status: 'skipped' },
  };
}

export type DoctorActionKind =
  | 'triaged'
  | 'diagnosed'
  | 'fix_applied'
  | 'fix_reverted'
  | 'fix_refused_sensitive'
  | 'schedule_quarantined'
  | 'proposal'
  /**
   * A finding handed to the daydream fault ledger because it needs repo code.
   *
   * Its own kind, not a `proposal`: `proposalsOpened` counts what the doctor
   * has written down for a human to read, and an escalation is what it handed
   * to another engine to act on. One number covering both would make a night
   * that escalated nothing look identical to one that escalated three.
   */
  | 'escalated'
  | 'finding_resolved'
  | 'lint_only';

/**
 * The plain-English record of one doctor action, captured WHERE THE FACTS ARE
 * KNOWN rather than reconstructed on the read side. Mirrors selfimprove's
 * ActionStory and exists for the same reason: re-parsing prose works until
 * someone rewords a template, and then it fails silently.
 */
export interface DoctorStory {
  /** "canvas:morning-briefing / Send WhatsApp" */
  subject: string;
  symptom: string;
  /** The redacted signature + occurrence count behind the symptom. */
  symptomEvidence?: string;
  occurrences?: number;
  cause: string;
  /**
   * Provenance of the cause. A linter fact and an LLM guess must never render
   * identically — the page shows a weaker chip for `llm`.
   */
  causeSource: 'signature' | 'linter' | 'llm';
  fix: string;
  fixMode: 'auto-apply' | 'propose-only' | 'refused';
  outcome: string;
  /** `measured` = the post-fix verify error count actually fell. */
  outcomeKind: 'measured' | 'expected' | 'unproven';
}

export interface DoctorAction {
  kind: DoctorActionKind;
  /** ALREADY passed through redactSensitive() before it is stored. */
  detail: string;
  story?: DoctorStory;
}

/** Shape of a `doctor_runs` record's `data`. key = crypto.randomUUID(). */
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
  /** Distinct workflows with >=1 qualifying failure in the window. */
  workflowsFailing: number;
  signaturesSeen: number;
  /** Snapshots of the switches at run time, so the page can mark shadow nights. */
  autoApplyEnabled: boolean;
  breakerEnabled: boolean;
  fixesApplied: number;
  fixesReverted: number;
  fixesRefusedSensitive: number;
  schedulesQuarantined: number;
  proposalsOpened: number;
  findingsResolved: number;
  /**
   * `executeTool` swallows send failures and returns { success: false }, which
   * is why the three existing nightly jobs are silent when the bridge is dead.
   * We record it instead, and the page says so.
   */
  whatsappDelivered: boolean;
  actions: DoctorAction[];
  report: string;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/**
 * Every fix kind the doctor can recognise. `mode` is fixed per kind and is not
 * a runtime decision — a kind is either mechanically safe or it is a proposal.
 */
export type FixKind =
  /** Node type is not in the registry at all — the graph cannot ever run. */
  | 'dead-node-type'
  /** An enabled cron schedule failing identically every run, no successes. */
  | 'runaway-schedule'
  /** configSchema has no such key; the value is dead weight. */
  | 'unknown-config-key'
  /** configSchema declares an enum and the stored value is not in it. */
  | 'enum-violation'
  /** A template references an upstream path that does not exist. */
  | 'broken-input-ref'
  /** A required field is empty and heuristic mapping can fill it. */
  | 'empty-required-field'
  /** Jinja/Handlebars block syntax the template engine does not support. */
  | 'unsupported-template-syntax'
  /** A credential or env var is absent. Nothing in the app can mint one. */
  | 'missing-credential'
  /** Provider billing/rate limit. Needs a human with a card. */
  | 'provider-limit'
  /** OAuth refresh token rejected — needs a reconnect. */
  | 'expired-oauth'
  /** Datastore row permissions deny the workflow actor. */
  | 'permission-denied'
  /** A secret is sitting in workflow_nodes.config. HARD REFUSAL to patch. */
  | 'secret-in-node-config'
  /** Recognised, but nothing mechanical to propose. */
  | 'unclassified';

export type FindingStatus =
  | 'proposed'
  | 'auto_fixed'
  | 'reverted'
  | 'refused_sensitive'
  | 'accepted'
  | 'dismissed'
  | 'resolved';

/**
 * One record per (workflowId, nodeId, signature) so a recurring failure
 * accumulates instead of duplicating night after night.
 * key = `${workflowId}:${nodeId ?? 'run'}:${hash12(signature)}`
 */
export interface DoctorFindingData {
  workflowId: string;
  workflowName: string;
  canvasSlug: string | null;
  nodeId: string | null;
  nodeType: string | null;
  nodeLabel: string | null;
  /** extractSignature() output, then redactSensitive(). */
  signature: string;
  fixKind: FixKind;
  status: FindingStatus;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  lastRunId: string | null;
  /** Plain English, machine-composed. No LLM prose. */
  symptom: string;
  cause: string;
  causeSource: 'signature' | 'linter' | 'llm';
  fix: string;
  lintIssues: Array<{ field: string; issue: string; severity: 'error' | 'warning' }>;
  /**
   * Field NAMES only — never values. Populated on `refused_sensitive` so the
   * report can say which field to look at without republishing the secret.
   */
  sensitiveFields?: string[];
  /** Populated on auto_fixed so the fix is revertible from the UI. */
  beforeImage?: {
    nodeId: string;
    version: number;
    changedFields: Record<string, unknown>;
    /** For runaway-schedule: the schedule row we flipped. */
    scheduleId?: string;
  };
  /** verifyWorkflow error counts either side of an applied fix. */
  verifyBefore?: number;
  verifyAfter?: number;
  updatedAt: string;
}

/** Which fix kinds may ever be applied without a human. */
export const AUTO_APPLY_KINDS: readonly FixKind[] = [
  'unknown-config-key',
  'enum-violation',
  'broken-input-ref',
  'empty-required-field',
  'unsupported-template-syntax',
] as const;

/**
 * The circuit breaker is deliberately NOT in AUTO_APPLY_KINDS: it is gated by
 * its own default-ON switch and writes to `workflow_schedules`, not to node
 * config, so it travels a different code path with different rails.
 */
export const BREAKER_KIND: FixKind = 'runaway-schedule';

/** Human-readable labels for the WhatsApp summary and the report page. */
export const FIX_KIND_LABELS: Record<FixKind, string> = {
  'dead-node-type': 'node type no longer exists',
  'runaway-schedule': 'runaway schedule',
  'unknown-config-key': 'unknown config key',
  'enum-violation': 'invalid dropdown value',
  'broken-input-ref': 'broken input reference',
  'empty-required-field': 'required field empty',
  'unsupported-template-syntax': 'unsupported template syntax',
  'missing-credential': 'missing credential',
  'provider-limit': 'provider limit',
  'expired-oauth': 'expired connection',
  'permission-denied': 'permission denied',
  'secret-in-node-config': 'secret in node config',
  unclassified: 'unclassified',
};

/** Default permission sets for the two system collections. */
export const SYSTEM_PERMISSIONS: Record<string, PermissionSet> = {
  doctor_runs: {
    read: ['owner', 'jkai', 'system'],
    write: ['system', 'owner'],
    delete: ['owner', 'system'],
  },
  doctor_findings: {
    read: ['owner', 'jkai', 'system'],
    write: ['system', 'owner'],
    delete: ['owner', 'system'],
  },
};

// ---------------------------------------------------------------------------
// Small shared helpers (mirrors selfimprove/types.ts)
// ---------------------------------------------------------------------------

/** Compact error message extractor. */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Cast a structured record shape to the datastore's generic `data` type. */
export function asData(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/**
 * Stable 12-char key fragment for a signature. Not crypto — this only has to be
 * deterministic and collision-resistant enough to key a finding.
 */
export function hash12(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12);
}

/** The datastore key for a finding. */
export function findingKey(workflowId: string, nodeId: string | null, signature: string): string {
  return `${workflowId}:${nodeId ?? 'run'}:${hash12(signature)}`;
}
