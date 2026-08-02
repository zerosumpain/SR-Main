// src/lib/workflowdoctor/fix.ts
//
// The only two places the doctor writes anything outside its own datastore
// collections. They are deliberately separate functions with separate switches
// and separate rails, and they must stay that way:
//
//   quarantineRunaways() flips `workflow_schedules.enabled` — one boolean, on a
//   table that holds no user data, which cannot reach `workflow_nodes.config`
//   and therefore cannot reach the audit-log credential-republish path at all.
//   Default ON, because it is the single highest-value action available: it is
//   the backstop that would have capped `icloud-cal` at ~10 failed runs instead
//   of 5,053.
//
//   applyFixes() writes `workflow_nodes.config` through mutate.server. Default
//   OFF (owner decision, 2026-08-02: config edits shadow on night one). Built
//   and tested in full so switching it on is a settings change, not a code
//   change.
//
// Nothing in here composes a WhatsApp line; report.ts takes counts and slugs
// only. Every string that leaves this module goes through redactSensitive()
// first, because a fix action quotes the failure that caused it.

import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { workflowAuditLog, workflowNodes, workflowSchedules } from '$lib/db/schema';
import { findSensitive, redactSensitive } from '$lib/security/sensitive';
import {
  credentialFields,
  mutateNodeConfig,
  revertNodeConfig,
  SensitiveRefusalError,
  VersionConflictError,
  type NodeBeforeImage,
} from '$lib/canvas/mutate.server';
import { getSetting } from '$lib/server/models/settings';
import type { VerificationIssue } from '$lib/workflows/orchestrator/verify';
import { lintWorkflow } from './lint';
import { upsertFinding } from './findings';
import type { RunawaySchedule } from './triage';
import {
  AUTO_APPLY_KINDS,
  BREAKER_KIND,
  FIX_KIND_LABELS,
  SETTINGS_AUTOAPPLY_KEY,
  SETTINGS_BREAKER_KEY,
  SYSTEM_ACTOR,
  WORK_CAPS,
  errMsg,
  findingKey,
  type DoctorAction,
  type FixKind,
} from './types';

/** v1 scope: the surface the request named, and the one with an export path. */
const CANVAS_PREFIX = 'canvas:';

const HOUR_MS = 60 * 60 * 1000;

/** Longest reason/detail we put on a run record. */
const MAX_DETAIL = 300;

function clip(text: string): string {
  return redactSensitive(text).slice(0, MAX_DETAIL);
}

// ---------------------------------------------------------------------------
// Switches
// ---------------------------------------------------------------------------

/**
 * Read a switch, failing CLOSED on any error.
 *
 * The house idiom is `!== false`, and the breaker keeps it. But "the settings
 * read threw" is not the same fact as "the setting is unset": if we cannot see
 * the kill switch we must not act as though it said yes. A night with no writes
 * costs nothing; a night that writes because the DB hiccuped is the failure
 * mode both switches exist to prevent.
 */
async function readSwitch(key: string, defaultOn: boolean): Promise<boolean> {
  try {
    const value = await getSetting<unknown>(key);
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return defaultOn;
  } catch (err) {
    console.error(`[workflowdoctor] settings read failed for ${key}:`, errMsg(err));
    return false;
  }
}

/** Circuit breaker. House semantics — only an explicit `false` disables it. */
export function isBreakerEnabled(): Promise<boolean> {
  return readSwitch(SETTINGS_BREAKER_KEY, true);
}

/** Node-config auto-apply. INVERTED — unset is off, only an explicit `true` arms it. */
export function isAutoApplyEnabled(): Promise<boolean> {
  return readSwitch(SETTINGS_AUTOAPPLY_KEY, false);
}

// ---------------------------------------------------------------------------
// A. The circuit breaker
// ---------------------------------------------------------------------------

export type QuarantineStatus = 'quarantined' | 'skipped' | 'failed';

export interface QuarantineOutcome {
  scheduleId: string;
  workflowId: string;
  canvasSlug: string | null;
  status: QuarantineStatus;
  reason: string;
  findingKey: string | null;
}

export interface QuarantineResult {
  outcomes: QuarantineOutcome[];
  quarantined: number;
  actions: DoctorAction[];
  /** Snapshot of the switch, for the run record's shadow-night marker. */
  enabled: boolean;
}

export interface QuarantineOptions {
  runId?: string | null;
  /** Injected for tests. Omitted → read from app_settings. */
  enabled?: boolean;
  /** Injected for tests. Omitted → WORK_CAPS.maxSchedulesQuarantined. */
  max?: number;
  actor?: string;
}

/**
 * The doctor has no node to point at when it pauses a schedule, and
 * `workflow_schedules` has no version counter. `scheduleId` is the real handle
 * — types.ts put it on the before-image for exactly this — and the revert path
 * branches on its presence. `nodeId` carries the same namespaced string so that
 * a caller which mistakenly routes this to `revertNodeConfig()` gets a
 * NodeNotFoundError instead of touching a real node.
 */
function scheduleHandle(scheduleId: string): string {
  return `schedule:${scheduleId}`;
}

/**
 * Pause every qualifying runaway schedule, up to the cap.
 *
 * This path NEVER touches `workflow_nodes.config`, so the sensitive-data gate
 * does not apply to it and is deliberately absent. If you are here to add a
 * config write, add it to applyFixes() instead — putting one here would drag
 * the whole audit-log credential-republish problem onto a default-ON switch.
 */
export async function quarantineRunaways(
  runaways: RunawaySchedule[],
  opts: QuarantineOptions = {},
): Promise<QuarantineResult> {
  const enabled = opts.enabled ?? (await isBreakerEnabled());
  const max = opts.max ?? WORK_CAPS.maxSchedulesQuarantined;
  const actor = opts.actor ?? SYSTEM_ACTOR;
  const runId = opts.runId ?? null;

  const outcomes: QuarantineOutcome[] = [];
  const actions: DoctorAction[] = [];
  if (!enabled) {
    return { outcomes, quarantined: 0, actions, enabled };
  }

  let quarantined = 0;
  for (const runaway of runaways) {
    const base = {
      scheduleId: runaway.scheduleId,
      workflowId: runaway.workflowId,
      canvasSlug: runaway.canvasSlug,
    };

    if (quarantined >= max) {
      outcomes.push({
        ...base,
        status: 'skipped',
        reason: `nightly cap of ${max} quarantines reached`,
        findingKey: null,
      });
      continue;
    }

    try {
      // Compare-and-swap on `enabled`: if a human disabled it between the
      // detector and here, no row comes back and we record nothing — a
      // before-image claiming we flipped it would offer a revert that re-arms a
      // schedule the owner had already stopped by hand.
      const flipped = await db
        .update(workflowSchedules)
        .set({ enabled: false })
        .where(
          and(eq(workflowSchedules.id, runaway.scheduleId), eq(workflowSchedules.enabled, true)),
        )
        .returning({ id: workflowSchedules.id });

      if (flipped.length === 0) {
        outcomes.push({
          ...base,
          status: 'skipped',
          reason: 'already disabled before we got to it',
          findingKey: null,
        });
        continue;
      }

      // The DB flag is the durable truth — the scheduler re-reads it on boot —
      // but the in-memory Cron keeps firing until the process restarts, and on
      // the VPS that is the same process the doctor is running in. Lazy import:
      // scheduler.ts pulls the whole engine, which must not enter this module's
      // graph. A failure here is logged, not fatal: the row is already flipped.
      try {
        const { unregisterCronJob } = await import('$lib/workflows/scheduler');
        unregisterCronJob(runaway.scheduleId);
      } catch (err) {
        console.error('[workflowdoctor] unregisterCronJob failed:', errMsg(err));
      }

      const subject = runaway.canvasSlug ?? runaway.workflowName;
      const symptom = `${runaway.consecutiveFailures} runs in a row failed, none succeeded`;
      const fix = 'Paused the schedule so it stops burning runs';
      const outcome =
        `${runaway.wastedRuns} run(s) were wasted in the last ${WORK_CAPS.lookbackDays} days. ` +
        `The cron is off; re-enable it once the canvas is fixed.`;

      const key = findingKey(runaway.workflowId, scheduleHandle(runaway.scheduleId), runaway.signature);
      await upsertFinding({
        workflowId: runaway.workflowId,
        workflowName: runaway.workflowName,
        canvasSlug: runaway.canvasSlug,
        nodeId: scheduleHandle(runaway.scheduleId),
        nodeType: null,
        nodeLabel: null,
        signature: runaway.signature,
        fixKind: BREAKER_KIND,
        status: 'auto_fixed',
        occurrences: runaway.wastedRuns,
        symptom,
        cause: runaway.signature,
        causeSource: 'signature',
        fix: `${fix}. ${outcome}`,
        beforeImage: {
          nodeId: scheduleHandle(runaway.scheduleId),
          version: 0,
          changedFields: { enabled: true },
          scheduleId: runaway.scheduleId,
        },
        runId,
      });

      actions.push({
        kind: 'schedule_quarantined',
        detail: clip(
          `${subject}: paused ${runaway.cronExpr || 'cron'} after ${runaway.consecutiveFailures} consecutive failures (${runaway.wastedRuns} wasted runs)`,
        ),
        story: {
          subject,
          symptom,
          symptomEvidence: redactSensitive(runaway.signature),
          occurrences: runaway.wastedRuns,
          cause: redactSensitive(runaway.signature),
          causeSource: 'signature',
          fix,
          fixMode: 'auto-apply',
          outcome,
          // The waste is a recorded number, not a projection: these runs
          // happened and the ones after tonight will not.
          outcomeKind: 'measured',
        },
      });

      quarantined++;
      outcomes.push({ ...base, status: 'quarantined', reason: 'breaker tripped', findingKey: key });
      console.log(`[workflowdoctor] quarantined ${quarantined}/${max} schedules`);
    } catch (err) {
      outcomes.push({ ...base, status: 'failed', reason: clip(errMsg(err)), findingKey: null });
      console.error('[workflowdoctor] quarantine failed:', errMsg(err));
    }
  }

  return { outcomes, quarantined, actions, enabled };
}

/** Put a quarantined schedule back. The manual "undo" behind a breaker finding. */
export async function releaseQuarantine(scheduleId: string): Promise<boolean> {
  const rows = await db
    .update(workflowSchedules)
    .set({ enabled: true })
    .where(and(eq(workflowSchedules.id, scheduleId), eq(workflowSchedules.enabled, false)))
    .returning({ id: workflowSchedules.id });
  if (rows.length === 0) return false;

  try {
    const { reloadSchedule } = await import('$lib/workflows/scheduler');
    await reloadSchedule(scheduleId);
  } catch (err) {
    console.error('[workflowdoctor] reloadSchedule failed:', errMsg(err));
  }
  return true;
}

// ---------------------------------------------------------------------------
// B. The node-config path — planning
// ---------------------------------------------------------------------------

export interface FixCandidate {
  workflowId: string;
  workflowName: string;
  canvasSlug?: string | null;
  nodeId: string;
  nodeType?: string | null;
  nodeLabel?: string | null;
  fixKind: FixKind;
  /** Redacted signature — the finding key is derived from it. */
  signature: string;
  occurrences?: number;
  symptom: string;
  cause: string;
  causeSource: 'signature' | 'linter' | 'llm';
  fix: string;
  /** This node's slice of WorkflowLint.byNodeId. Drives planFix(). */
  lintIssues?: VerificationIssue[];
  /** Supplied → used verbatim. Omitted → derived by planFix(). */
  patch?: Record<string, unknown>;
  removeKeys?: string[];
}

export interface FixPlan {
  patch?: Record<string, unknown>;
  removeKeys?: string[];
  /** Config keys the plan touches. Feeds the emptiness rail and the story. */
  fields: string[];
  /** Plain English, for the action detail. */
  summary: string;
}

/** compatibility.ts:128's isEmpty, verbatim. A string of spaces is human-set. */
function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/** Quoted or bare enum members out of a verifier message. */
function parseAllowed(list: string): string[] {
  return list
    .split(',')
    .map((v) => v.trim().replace(/^["']|["'][.]?$/g, '').replace(/\.$/, '').trim())
    .filter(Boolean);
}

const UNKNOWN_KEY_RE = /^Unknown config key "(.+?)"/;
const ENUM_LIST_RE = /^Invalid value for "(.+?)": (?:.+?)\. Must be one of: (.+?)\.?$/;
const ENUM_SEMANTIC_RE = /^\S+ (\w+) must be one of (.+?) \(got [^)]*\)/;

/** Jinja and Handlebars blocks. Rewriting these needs an upstream node, not a patch. */
const TEMPLATE_BLOCK_RE = /\{%|\{\{\s*[#/]/;
/** The only mechanical template repair: `{{ input.x }}` → `{{input.x}}`. */
const TEMPLATE_PADDING_RE = /\{\{\s+([^{}]*?)\s*\}\}|\{\{\s*([^{}]*?)\s+\}\}/;

/**
 * Turn a diagnosis into a concrete mutation, or null when there is nothing
 * mechanical to do.
 *
 * Only three kinds are derivable from what the linter already tells us:
 * `unknown-config-key` (the key is in the message), `enum-violation` (so are the
 * legal values) and the whitespace half of `unsupported-template-syntax`.
 *
 * `broken-input-ref` and `empty-required-field` need the upstream schema and
 * heuristicMapping — the graph, not this node — so they return null here and the
 * caller must supply an explicit `patch`. Both remain fully supported by
 * applyFixes; they just cannot be planned from a lint message alone.
 */
export function planFix(
  candidate: FixCandidate,
  config: Record<string, unknown>,
): FixPlan | null {
  if (candidate.patch || candidate.removeKeys?.length) {
    const fields = [...new Set([...Object.keys(candidate.patch ?? {}), ...(candidate.removeKeys ?? [])])];
    if (fields.length === 0) return null;
    return {
      patch: candidate.patch,
      removeKeys: candidate.removeKeys,
      fields,
      summary: `set ${fields.join(', ')}`,
    };
  }

  const issues = (candidate.lintIssues ?? []).filter((i) => i.severity === 'error');

  if (candidate.fixKind === 'unknown-config-key') {
    const keys = new Set<string>();
    for (const issue of issues) {
      const m = UNKNOWN_KEY_RE.exec(issue.issue ?? '');
      if (!m) continue;
      const key = issue.field || m[1];
      // Only delete what is actually there. A key the verifier named but the
      // stored config no longer has means the graph moved under us.
      if (key && key in config) keys.add(key);
    }
    if (keys.size === 0) return null;
    const fields = [...keys];
    return { removeKeys: fields, fields, summary: `removed ${fields.join(', ')}` };
  }

  if (candidate.fixKind === 'enum-violation') {
    for (const issue of issues) {
      const listed = ENUM_LIST_RE.exec(issue.issue ?? '');
      const semantic = listed ? null : ENUM_SEMANTIC_RE.exec(issue.issue ?? '');
      if (!listed && !semantic) continue;

      const field = issue.field || (listed ? listed[1] : semantic![1]);
      const allowed = parseAllowed(listed ? listed[2] : semantic![2]);
      const current = config[field];
      if (!field || typeof current !== 'string' || allowed.length === 0) continue;

      // Snap only a casing/whitespace slip. A value that resembles nothing legal
      // ('browse' against vnc|confirm|both) is a decision, not a typo, and
      // picking for the owner would be a guess wearing a fix's clothes.
      const needle = current.trim().toLowerCase();
      const matches = allowed.filter((a) => a.toLowerCase() === needle);
      if (matches.length !== 1 || matches[0] === current) continue;

      return {
        patch: { [field]: matches[0] },
        fields: [field],
        summary: `set ${field} to a legal value`,
      };
    }
    return null;
  }

  if (candidate.fixKind === 'unsupported-template-syntax') {
    for (const issue of issues) {
      const field = issue.field;
      const current = field ? config[field] : undefined;
      if (typeof current !== 'string' || !current) continue;
      // A loop or a conditional is a proposal with a node type named in it, not
      // an unattended patch.
      if (TEMPLATE_BLOCK_RE.test(current)) continue;
      if (!TEMPLATE_PADDING_RE.test(current)) continue;
      const next = current.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_m, inner: string) => `{{${inner.trim()}}}`);
      if (next === current) continue;
      return {
        patch: { [field]: next },
        fields: [field],
        summary: `tidied the placeholders in ${field}`,
      };
    }
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// B. The node-config path — applying
// ---------------------------------------------------------------------------

export type FixOutcomeStatus =
  | 'applied'
  | 'reverted'
  | 'refused_sensitive'
  | 'conflict'
  | 'skipped'
  | 'failed';

export interface FixOutcome {
  workflowId: string;
  nodeId: string;
  fixKind: FixKind;
  status: FixOutcomeStatus;
  reason: string;
  findingKey: string;
  verifyBefore?: number;
  verifyAfter?: number;
}

export interface FixResult {
  outcomes: FixOutcome[];
  applied: number;
  reverted: number;
  refusedSensitive: number;
  actions: DoctorAction[];
  /** Snapshot of the switch, for the run record's shadow-night marker. */
  enabled: boolean;
}

/** WORK_CAPS is `as const`, so its members are literal types — widen for tests. */
export interface FixCaps {
  maxWorkflowsMutated: number;
  maxAutoFixesTotal: number;
  maxNodeWritesPerWorkflow: number;
  humanEditQuietHours: number;
}

export interface ApplyFixesOptions {
  runId?: string | null;
  /** Injected for tests. Omitted → read from app_settings (default OFF). */
  enabled?: boolean;
  actor?: string;
  caps?: Partial<FixCaps>;
}

/**
 * Config keys whose value trips the site-wide detector, and the ones that are
 * specifically credentials.
 *
 * `credentialFields` is reused from mutate.server rather than re-derived — the
 * doctor must refuse over exactly the same rule the write adapter enforces, or
 * one of them is wrong. The wider `findSensitive` sweep is the doctor's own
 * additional rail (DESIGN §Safety 5): an unattended writer has no business
 * touching a node holding personal data either, but a phone number in a
 * `whatsapp.to` is not a leaked secret and must not be reported as one.
 */
function sensitiveScan(config: Record<string, unknown>): {
  credentials: string[];
  personal: string[];
} {
  const credentials = credentialFields(config);
  const credentialSet = new Set(credentials);
  const personal: string[] = [];
  for (const [key, value] of Object.entries(config ?? {})) {
    if (credentialSet.has(key)) continue;
    let json = '';
    try {
      json = JSON.stringify({ [key]: value }) ?? '';
    } catch {
      continue;
    }
    if (findSensitive(json).length > 0) personal.push(key);
  }
  return { credentials, personal };
}

/** True when a human touched this workflow inside the quiet window. */
async function humanEditedRecently(
  workflowId: string,
  quietHours: number,
  actor: string,
): Promise<boolean> {
  const since = new Date(Date.now() - quietHours * HOUR_MS);
  const rows = await db
    .select({ id: workflowAuditLog.id })
    .from(workflowAuditLog)
    .where(
      and(
        eq(workflowAuditLog.workflowId, workflowId),
        gte(workflowAuditLog.at, since),
        // Our own writes land in the same table. Excluding them keeps a second
        // fix on the same canvas from being blocked by the first.
        sql`${workflowAuditLog.details}->>'actor' IS DISTINCT FROM ${actor}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function loadNodeConfig(
  workflowId: string,
  nodeId: string,
): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select({ config: workflowNodes.config })
    .from(workflowNodes)
    .where(and(eq(workflowNodes.id, nodeId), eq(workflowNodes.workflowId, workflowId)))
    .limit(1);
  return row ? ((row.config as Record<string, unknown>) ?? {}) : null;
}

/**
 * Apply the whitelist, one candidate at a time, and undo anything that did not
 * demonstrably help.
 *
 * Every rail is a separate early exit with its own reason string, because
 * "skipped" with no explanation is how a safety gate quietly stops being one.
 * The order is cheapest-and-most-absolute first: switch, whitelist, scope, caps,
 * quiet window, plan, emptiness, sensitive scan, and only then a write.
 */
export async function applyFixes(
  candidates: FixCandidate[],
  opts: ApplyFixesOptions = {},
): Promise<FixResult> {
  const enabled = opts.enabled ?? (await isAutoApplyEnabled());
  const actor = opts.actor ?? SYSTEM_ACTOR;
  const runId = opts.runId ?? null;
  const caps = {
    maxWorkflowsMutated: opts.caps?.maxWorkflowsMutated ?? WORK_CAPS.maxWorkflowsMutated,
    maxAutoFixesTotal: opts.caps?.maxAutoFixesTotal ?? WORK_CAPS.maxAutoFixesTotal,
    maxNodeWritesPerWorkflow:
      opts.caps?.maxNodeWritesPerWorkflow ?? WORK_CAPS.maxNodeWritesPerWorkflow,
    humanEditQuietHours: opts.caps?.humanEditQuietHours ?? WORK_CAPS.humanEditQuietHours,
  };

  const outcomes: FixOutcome[] = [];
  const actions: DoctorAction[] = [];
  let applied = 0;
  let reverted = 0;
  let refusedSensitive = 0;

  const skip = (c: FixCandidate, reason: string): void => {
    outcomes.push({
      workflowId: c.workflowId,
      nodeId: c.nodeId,
      fixKind: c.fixKind,
      status: 'skipped',
      reason,
      findingKey: findingKey(c.workflowId, c.nodeId, c.signature),
    });
  };

  // Rail 1. Nothing below this line runs on a shadow night — not a query, not a
  // read of the node. The propose phase turns these into findings instead.
  if (!enabled) {
    for (const c of candidates) skip(c, 'auto-apply switch is off — proposed instead');
    return { outcomes, applied, reverted, refusedSensitive, actions, enabled };
  }

  const touchedWorkflows = new Set<string>();
  const writesPerWorkflow = new Map<string, number>();
  /** Cached BEFORE our first write to that workflow, so we never gate on ourselves. */
  const quietWindow = new Map<string, boolean>();
  /** A conflict aborts every remaining fix on that node for the night. */
  const abandoned = new Set<string>();

  for (const candidate of candidates) {
    const { workflowId, nodeId } = candidate;
    const key = findingKey(workflowId, nodeId, candidate.signature);
    const nodeKey = `${workflowId}:${nodeId}`;

    // Rail 2. The whitelist is fixed per kind, not a runtime judgement.
    if (!AUTO_APPLY_KINDS.includes(candidate.fixKind)) {
      skip(candidate, `${FIX_KIND_LABELS[candidate.fixKind]} is propose-only`);
      continue;
    }
    // Rail 3. v1 scope.
    if (!candidate.workflowName.startsWith(CANVAS_PREFIX)) {
      skip(candidate, 'not a canvas workflow — outside v1 auto-apply scope');
      continue;
    }
    if (abandoned.has(nodeKey)) {
      skip(candidate, 'an earlier fix on this node conflicted — abandoned for tonight');
      continue;
    }

    // Rail 9. Caps.
    if (applied + reverted >= caps.maxAutoFixesTotal) {
      skip(candidate, `nightly cap of ${caps.maxAutoFixesTotal} fixes reached`);
      continue;
    }
    if (!touchedWorkflows.has(workflowId) && touchedWorkflows.size >= caps.maxWorkflowsMutated) {
      skip(candidate, `nightly cap of ${caps.maxWorkflowsMutated} workflows reached`);
      continue;
    }
    if ((writesPerWorkflow.get(workflowId) ?? 0) >= caps.maxNodeWritesPerWorkflow) {
      skip(candidate, `cap of ${caps.maxNodeWritesPerWorkflow} writes on this workflow reached`);
      continue;
    }

    try {
      // Rail 4. Never touch a workflow a human touched recently.
      if (!quietWindow.has(workflowId)) {
        quietWindow.set(
          workflowId,
          await humanEditedRecently(workflowId, caps.humanEditQuietHours, actor),
        );
      }
      if (quietWindow.get(workflowId)) {
        skip(candidate, `edited by hand in the last ${caps.humanEditQuietHours}h`);
        continue;
      }

      const config = await loadNodeConfig(workflowId, nodeId);
      if (!config) {
        skip(candidate, 'node no longer exists');
        continue;
      }

      const plan = planFix(candidate, config);
      if (!plan) {
        skip(candidate, 'nothing mechanical to change — proposed instead');
        continue;
      }

      // Rail 6. Never overwrite a human-set value. Only the kinds whose whole
      // premise is "this field is blank" are held to it; broken-input-ref is
      // the one whitelist kind that deliberately does overwrite, which is why
      // it needs both static and runtime evidence upstream of here.
      if (candidate.fixKind === 'empty-required-field') {
        const occupied = Object.keys(plan.patch ?? {}).filter((k) => !isEmptyValue(config[k]));
        if (occupied.length > 0) {
          skip(candidate, `${occupied.join(', ')} already has a value — not overwriting it`);
          continue;
        }
      }

      // Rail 5. The doctor's own sensitive gate, wider than the write adapter's.
      // A credential is a hard refusal that the owner must see; personal data is
      // simply not something an unattended writer should be moving around, and
      // saying "secret in node config" about a WhatsApp recipient would be a
      // false alarm on the one line of the report that demands a human.
      const projected: Record<string, unknown> = { ...config, ...(plan.patch ?? {}) };
      for (const k of plan.removeKeys ?? []) delete projected[k];
      const before = sensitiveScan(config);
      const after = sensitiveScan(projected);
      const credentials = [...new Set([...before.credentials, ...after.credentials])];
      if (credentials.length > 0) {
        await recordRefusal(candidate, credentials, runId);
        refusedSensitive++;
        outcomes.push({
          workflowId,
          nodeId,
          fixKind: candidate.fixKind,
          status: 'refused_sensitive',
          reason: `credential in ${credentials.join(', ')} — delete the node, never patch it`,
          findingKey: key,
        });
        actions.push(refusalAction(candidate, credentials));
        continue;
      }
      const personal = [...new Set([...before.personal, ...after.personal])];
      if (personal.length > 0) {
        skip(candidate, `config holds personal data (${personal.join(', ')}) — not patching unattended`);
        continue;
      }

      const verifyBefore = (await lintWorkflow(workflowId)).errorCount;

      let beforeImage: NodeBeforeImage;
      try {
        const res = await mutateNodeConfig({
          workflowId,
          nodeId,
          patch: plan.patch,
          removeKeys: plan.removeKeys,
          actor,
          reason: `workflowdoctor: ${candidate.fixKind}`,
        });
        beforeImage = res.before;
      } catch (err) {
        // Rail 5 backstop. The wider scan above should have caught this, but the
        // adapter is the authority and its refusal is the one that matters.
        if (err instanceof SensitiveRefusalError) {
          await recordRefusal(candidate, err.fields, runId);
          refusedSensitive++;
          outcomes.push({
            workflowId,
            nodeId,
            fixKind: candidate.fixKind,
            status: 'refused_sensitive',
            reason: `credential in ${err.fields.join(', ')} — delete the node, never patch it`,
            findingKey: key,
          });
          actions.push(refusalAction(candidate, err.fields));
          continue;
        }
        // Rail 8. Someone edited the node between the read and the write. Do not
        // retry: the config we planned against is gone, and a retry would apply
        // a patch derived from a graph that no longer exists.
        if (err instanceof VersionConflictError) {
          abandoned.add(nodeKey);
          outcomes.push({
            workflowId,
            nodeId,
            fixKind: candidate.fixKind,
            status: 'conflict',
            reason: 'node changed under us — abandoned, no retry',
            findingKey: key,
          });
          continue;
        }
        throw err;
      }

      touchedWorkflows.add(workflowId);
      writesPerWorkflow.set(workflowId, (writesPerWorkflow.get(workflowId) ?? 0) + 1);

      // Rail 7. The whole-graph error count must STRICTLY decrease. Equal is not
      // good enough: a patch that changes nothing measurable is a patch we
      // cannot defend, and the owner would find it in the audit log with no
      // evidence attached.
      // A lint that throws AFTER the write is the one case where "failed" is not
      // enough: the node is already changed and nobody measured it. Treat an
      // unmeasurable outcome exactly as a bad one.
      let verifyAfter: number;
      try {
        verifyAfter = (await lintWorkflow(workflowId)).errorCount;
      } catch (err) {
        console.error('[workflowdoctor] post-fix lint failed:', errMsg(err));
        verifyAfter = verifyBefore;
      }
      if (verifyAfter >= verifyBefore) {
        const undone = await tryRevert(beforeImage, actor);
        reverted++;
        outcomes.push({
          workflowId,
          nodeId,
          fixKind: candidate.fixKind,
          status: undone ? 'reverted' : 'failed',
          reason: undone
            ? `errors went ${verifyBefore} → ${verifyAfter}, not down — reverted`
            : `errors went ${verifyBefore} → ${verifyAfter} and the revert failed — the change is still in place`,
          findingKey: key,
          verifyBefore,
          verifyAfter,
        });
        await upsertFinding({
          ...findingBase(candidate, runId),
          status: undone ? 'reverted' : 'auto_fixed',
          fix: undone
            ? `${candidate.fix} (tried automatically and put back: it did not reduce the errors on this canvas)`
            : `${candidate.fix} (applied, but it did not reduce the errors and the automatic undo failed — revert it from this finding)`,
          beforeImage: {
            nodeId: beforeImage.nodeId,
            version: beforeImage.version,
            changedFields: beforeImage.changedFields,
          },
          verifyBefore,
          verifyAfter,
        });
        actions.push({
          kind: 'fix_reverted',
          detail: clip(
            `${subjectOf(candidate)}: ${plan.summary} — errors ${verifyBefore} → ${verifyAfter}, ${undone ? 'reverted' : 'REVERT FAILED'}`,
          ),
          story: {
            ...storyBase(candidate),
            fix: candidate.fix,
            fixMode: 'auto-apply',
            outcome: `Put it back — the canvas went from ${verifyBefore} to ${verifyAfter} errors instead of down.`,
            outcomeKind: 'unproven',
          },
        });
        continue;
      }

      applied++;
      outcomes.push({
        workflowId,
        nodeId,
        fixKind: candidate.fixKind,
        status: 'applied',
        reason: `errors ${verifyBefore} → ${verifyAfter}`,
        findingKey: key,
        verifyBefore,
        verifyAfter,
      });
      await upsertFinding({
        ...findingBase(candidate, runId),
        status: 'auto_fixed',
        beforeImage: {
          nodeId: beforeImage.nodeId,
          version: beforeImage.version,
          changedFields: beforeImage.changedFields,
        },
        verifyBefore,
        verifyAfter,
      });
      actions.push({
        kind: 'fix_applied',
        detail: clip(`${subjectOf(candidate)}: ${plan.summary} — errors ${verifyBefore} → ${verifyAfter}`),
        story: {
          ...storyBase(candidate),
          fix: candidate.fix,
          fixMode: 'auto-apply',
          outcome: `The canvas went from ${verifyBefore} to ${verifyAfter} errors.`,
          outcomeKind: 'measured',
        },
      });
      console.log(`[workflowdoctor] applied ${applied}, reverted ${reverted} of ${caps.maxAutoFixesTotal}`);
    } catch (err) {
      outcomes.push({
        workflowId,
        nodeId,
        fixKind: candidate.fixKind,
        status: 'failed',
        reason: clip(errMsg(err)),
        findingKey: key,
      });
      console.error('[workflowdoctor] fix failed:', errMsg(err));
    }
  }

  return { outcomes, applied, reverted, refusedSensitive, actions, enabled };
}

// ---------------------------------------------------------------------------
// Shared record shapes
// ---------------------------------------------------------------------------

function subjectOf(c: FixCandidate): string {
  const canvas = c.canvasSlug ?? c.workflowName;
  const node = c.nodeLabel ?? c.nodeType ?? 'node';
  return `${canvas} / ${node}`;
}

function findingBase(c: FixCandidate, runId: string | null) {
  return {
    workflowId: c.workflowId,
    workflowName: c.workflowName,
    canvasSlug: c.canvasSlug ?? null,
    nodeId: c.nodeId,
    nodeType: c.nodeType ?? null,
    nodeLabel: c.nodeLabel ?? null,
    signature: c.signature,
    fixKind: c.fixKind,
    occurrences: c.occurrences ?? 0,
    symptom: c.symptom,
    cause: c.cause,
    causeSource: c.causeSource,
    fix: c.fix,
    lintIssues: (c.lintIssues ?? []).map((i) => ({
      field: i.field,
      issue: i.issue,
      severity: i.severity,
    })),
    runId,
  };
}

function storyBase(c: FixCandidate) {
  return {
    subject: subjectOf(c),
    symptom: c.symptom,
    symptomEvidence: redactSensitive(c.signature),
    occurrences: c.occurrences,
    cause: c.cause,
    causeSource: c.causeSource,
  };
}

/**
 * A refusal is the only outcome that names fields and writes NO before-image:
 * there is nothing to revert because nothing was written, and a before-image on
 * a credential-bearing node would be a second copy of the secret.
 */
async function recordRefusal(
  c: FixCandidate,
  fields: string[],
  runId: string | null,
): Promise<void> {
  await upsertFinding({
    ...findingBase(c, runId),
    fixKind: 'secret-in-node-config',
    status: 'refused_sensitive',
    fix: 'Delete the node and recreate it. A PATCH republishes the value through workflow_audit_log.details, so redacting it in place would leak it.',
    sensitiveFields: fields,
  });
}

function refusalAction(c: FixCandidate, fields: string[]): DoctorAction {
  return {
    kind: 'fix_refused_sensitive',
    // Field NAMES only. This string reaches the run record and the report page.
    detail: clip(`${subjectOf(c)}: credential in ${fields.join(', ')} — not patched`),
    story: {
      ...storyBase(c),
      cause: `This node's config holds a credential in ${fields.join(', ')}.`,
      fix: 'Delete the node and recreate it — patching it would republish the secret into the audit log.',
      fixMode: 'refused',
      outcome: 'Nothing was written. This one needs you.',
      outcomeKind: 'unproven',
    },
  };
}

/** Revert, reporting whether the node actually got back. */
async function tryRevert(beforeImage: NodeBeforeImage, actor: string): Promise<boolean> {
  try {
    await revertNodeConfig(beforeImage, actor);
    return true;
  } catch (err) {
    console.error('[workflowdoctor] revert failed:', errMsg(err));
    return false;
  }
}
