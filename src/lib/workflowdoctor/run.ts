// src/lib/workflowdoctor/run.ts
//
// The nightly pipeline + its guards. `runDoctorNow` is the single entry point
// (the cron in engine.ts and the admin "Run now" button). It NEVER throws into
// its caller except the overlap guard — every phase is independently try/caught,
// the run is marked `partial` on a phase failure, `budget_exceeded` on a hard
// cap, `aborted_user_active` if the user shows up mid-run (cron only), and
// `failed` only on a top-level surprise.
//
// Shape cloned from $lib/selfimprove/run: same Budget object, same [name, fn]
// phase array, same safePersist-after-every-phase so a crash still leaves a
// readable record, same report-outside-the-loop.
//
// The one structural difference is that this pipeline can WRITE to production
// canvases, so it carries two extra rails: a pg advisory lock on top of the
// process-local overlap guard, and two switches snapshotted onto the run record
// so a shadow night is never mistaken for a night that chose not to fix.

import { getSetting } from '$lib/server/models/settings';
import { withActivity } from '$lib/context/activity';
import { upsertRecord } from '$lib/datastore';
import { isUserActive } from '$lib/selfimprove/run';
import { releaseAdvisoryLock, tryAdvisoryLock } from '$lib/workflows/leader-lock';
import type { VerificationIssue } from '$lib/workflows/orchestrator/verify';
import {
  AUTO_APPLY_KINDS,
  BUDGET_CAPS,
  COLLECTIONS,
  DOCTOR_LOCK_LANE,
  IDLE_WINDOW_MS,
  SETTINGS_AUTOAPPLY_KEY,
  SETTINGS_BREAKER_KEY,
  SYSTEM_ACTOR,
  WORK_CAPS,
  asData,
  emptyPhases,
  errMsg,
  findingKey,
  type DoctorAction,
  type DoctorActionKind,
  type DoctorRunData,
  type PhaseName,
} from './types';
import { ensureDoctorCollections, getFinding, resolveStaleFindings, upsertFinding } from './findings';
import { escalateFindings } from './escalate';
import { lintWorkflows, type WorkflowLint } from './lint';
import { signatureOf, triageNow, type TriageResult, type TriageSignature } from './triage';
import { classifySignature, diagnoseWithLlm, type ClassifyInput, type Diagnosis } from './classify';
import { applyFixes, quarantineRunaways, type FixCandidate } from './fix';
import { finalizeAndNotify } from './report';

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export interface LlmCallOpts {
  maxTokens?: number;
  temperature?: number;
  /**
   * Accepted for structural compatibility with classify.ts's DoctorBudget and
   * deliberately IGNORED — the pin below is the point of pinning.
   */
  model?: string;
}

export interface Budget {
  llmCalls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  exceeded: boolean;
  /** One gateway completion, budget-checked BEFORE the call. Throws
   *  BudgetExceededError once a hard cap is reached. Returns raw + parsed JSON. */
  call(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    opts?: LlmCallOpts,
  ): Promise<{ content: string; json: unknown }>;
  /**
   * Wall-clock remaining. The diagnose phase loops internally, so it needs to
   * self-limit — the between-phase check alone would let one long loop eat the
   * minute the report phase is owed.
   */
  timeLeftMs(): number;
}

type Caps = { maxLlmCalls: number; maxCostUsd: number; maxWallMs: number };

/**
 * Strict parse only. `coerceDiagnosis` in classify.ts already owns the loose
 * recovery (fences, apologies) and re-parses the raw string when `json` is
 * null, so duplicating that logic here would give us two parsers to keep in
 * step.
 */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Create a fresh budget counter. Caps are overridable for tests. */
export function createBudget(caps: Partial<Caps> = {}): Budget {
  const maxLlmCalls = caps.maxLlmCalls ?? BUDGET_CAPS.maxLlmCalls;
  const maxCostUsd = caps.maxCostUsd ?? BUDGET_CAPS.maxCostUsd;
  const maxWallMs = caps.maxWallMs ?? BUDGET_CAPS.maxWallMs;
  const startedAt = Date.now();

  const budget: Budget = {
    llmCalls: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    exceeded: false,
    timeLeftMs() {
      return Math.max(0, maxWallMs - (Date.now() - startedAt));
    },
    async call(messages, opts) {
      if (budget.llmCalls >= maxLlmCalls || budget.costUsd >= maxCostUsd) {
        budget.exceeded = true;
        throw new BudgetExceededError(
          `budget exceeded (calls=${budget.llmCalls}/${maxLlmCalls}, cost=$${budget.costUsd.toFixed(3)}/$${maxCostUsd})`,
        );
      }
      // Lazy imports keep the module light for tests that never reach the gateway.
      const { getLLMClient } = await import('$lib/llm/client');
      const { priceFor, computeCost } = await import('$lib/llm/pricing');

      // Still pinned off the chat default: this pipeline decides what gets
      // written to a live canvas, so a change to the chat default must not
      // silently change the quality of that judgement. The pin is now the
      // `jkai.workflowdoctor.model` setting (falling back to DOCTOR_MODEL), so
      // it can be read and changed from the model picker instead of only here.
      const { resolveDoctorModel } = await import('$lib/server/models/workload-settings');
      const modelCtx = await resolveDoctorModel();
      const { client, model } = await getLLMClient(modelCtx);
      // max_tokens >= 3000 so a reasoning model doesn't burn the allowance
      // before it emits the object (feedback_glm_reasoning_tokens).
      const resp = await withActivity('doctor', () =>
        client.chat.completions.create({
          model,
          messages,
          max_tokens: Math.max(opts?.maxTokens ?? 3000, 3000),
          temperature: opts?.temperature ?? 0.2,
        }),
      );

      budget.llmCalls++;
      const usage = resp.usage;
      if (usage) {
        const tin = usage.prompt_tokens ?? 0;
        const tout = usage.completion_tokens ?? 0;
        budget.tokensIn += tin;
        budget.tokensOut += tout;
        // Price against the provider we actually called. Hardcoding 'openrouter'
        // was harmless while the model was pinned to an OpenRouter slug; now
        // that it is settable, a Codex pick would otherwise be priced off an
        // OpenRouter table it does not appear in.
        const pricing = priceFor(modelCtx.provider, resp.model || model);
        if (pricing) budget.costUsd += computeCost(pricing, tin, tout);
      }
      const content = resp.choices?.[0]?.message?.content ?? '';
      return { content, json: parseJson(content) };
    },
  };
  return budget;
}

// ---------------------------------------------------------------------------
// Run lock + status
// ---------------------------------------------------------------------------

let running = false;
let lastRunId: string | undefined;

export function getDoctorStatus(): { running: boolean; lastRunId?: string } {
  return { running, lastRunId };
}

/** Overlap guard: succeeds only if no run is in progress in THIS process. */
export function acquireRunLock(): boolean {
  if (running) return false;
  running = true;
  return true;
}

export function releaseRunLock(): void {
  running = false;
}

// ---------------------------------------------------------------------------
// Candidates — the unit of work the diagnose / fix / propose phases share
// ---------------------------------------------------------------------------

/** One (workflow, node, signature) the doctor will explain and act on. */
export interface DoctorCandidate {
  /** `dead-node-type` candidates are reported even with zero runtime failures. */
  source: 'runtime' | 'dead-node-type';
  workflowId: string;
  workflowName: string;
  canvasSlug: string | null;
  nodeId: string | null;
  nodeType: string | null;
  nodeLabel: string | null;
  /** Redacted + truncated: triage's signatureOf() output, never a raw error. */
  signature: string;
  /** Failures inside WORK_CAPS.lookbackDays. */
  occurrences: number;
  lastRunId: string | null;
  lintIssues: VerificationIssue[];
  /** pickSuccessor()'s guess for a retired node type. Evidence, not a plan. */
  successor: string | null;
}

export interface DiagnosedCandidate {
  candidate: DoctorCandidate;
  diagnosis: Diagnosis;
}

/**
 * Outcome statuses that mean fix.ts already wrote the finding, so the propose
 * phase must leave it alone: it holds the before-image and the verify numbers,
 * and a propose-shaped overwrite would drop both. Every other status (skipped
 * on a shadow night, a version conflict, a failure) leaves the record to us.
 */
const FIX_OWNS_FINDING = new Set(['applied', 'reverted', 'refused_sensitive']);

/** Statuses that actually mutated the graph, and so are worth re-linting. */
const FIX_MUTATED = new Set(['applied', 'reverted']);

/** `No executor found for node type: icloud-cal` → `icloud-cal`. */
const DEAD_TYPE_RE = /^No executor found for node type:\s*(\S+)/;

function subjectOf(c: DoctorCandidate): string {
  return `${c.workflowName} / ${c.nodeLabel ?? c.nodeType ?? 'run'}`;
}

/**
 * Flatten the triage result into the work list.
 *
 * The run-level `No executor found for node type: X` signature is FOLDED into
 * the node-level dead-type row: same defect, but only the node-level row can
 * name the node and its likely successor. Without the fold the six orphaned
 * nodes each produce two findings, one of them nodeId-less and carrying all the
 * volume.
 */
export function buildCandidates(
  triage: TriageResult,
  lints: Map<string, WorkflowLint>,
): DoctorCandidate[] {
  const runLevel = new Map<string, TriageSignature>();
  const folded = new Set<TriageSignature>();
  for (const s of triage.signatures) {
    const m = DEAD_TYPE_RE.exec(s.signature);
    if (!m) continue;
    const k = `${s.workflowId} ${m[1]}`;
    const prev = runLevel.get(k);
    if (!prev || s.count > prev.count) runLevel.set(k, s);
  }

  const out: DoctorCandidate[] = [];
  const claimed = new Set<string>();

  for (const d of triage.deadNodeTypes) {
    const k = `${d.workflowId} ${d.deadType}`;
    const s = runLevel.get(k);
    if (s) folded.add(s);
    // The run dies at the FIRST dead node it reaches, so only that node inherits
    // the run-level volume; a sibling of the same type in the same graph has
    // never actually been executed.
    const inherit = s !== undefined && !claimed.has(k);
    if (inherit) claimed.add(k);
    out.push({
      source: 'dead-node-type',
      workflowId: d.workflowId,
      workflowName: d.workflowName,
      canvasSlug: d.canvasSlug,
      nodeId: d.nodeId,
      nodeType: d.deadType,
      nodeLabel: d.nodeLabel,
      // Through signatureOf() even when synthesised, so the day this canvas is
      // re-enabled the runtime failure keys onto the SAME finding.
      signature: s?.signature ?? signatureOf(`No executor found for node type: ${d.deadType}`),
      occurrences: inherit && s ? s.count : 0,
      lastRunId: inherit && s ? s.lastRunId : null,
      lintIssues: lints.get(d.workflowId)?.byNodeId[d.nodeId] ?? [],
      successor: d.candidate,
    });
  }

  for (const s of triage.signatures) {
    if (folded.has(s)) continue;
    out.push({
      source: 'runtime',
      workflowId: s.workflowId,
      workflowName: s.workflowName,
      canvasSlug: s.canvasSlug,
      nodeId: s.nodeId,
      nodeType: s.nodeType,
      nodeLabel: s.nodeLabel,
      signature: s.signature,
      occurrences: s.count,
      lastRunId: s.lastRunId,
      lintIssues: s.nodeId ? (lints.get(s.workflowId)?.byNodeId[s.nodeId] ?? []) : [],
      successor: null,
    });
  }

  return out
    .sort((a, b) => b.occurrences - a.occurrences || a.signature.localeCompare(b.signature))
    .slice(0, WORK_CAPS.maxSignatures);
}

/**
 * A one-off failure is noise; a dead node type is not, however quiet it is.
 * Both canvases carrying the six orphaned nodes have had their schedules
 * disabled by hand, so they produce zero failures in the window — an
 * occurrence-only threshold would hide exactly the thing this engine was built
 * to find.
 */
function worthReporting(c: DoctorCandidate): boolean {
  return c.source === 'dead-node-type' || c.occurrences >= WORK_CAPS.minOccurrences;
}

function classifyInputOf(c: DoctorCandidate): ClassifyInput {
  return {
    signature: c.signature,
    nodeType: c.nodeType,
    nodeLabel: c.nodeLabel,
    workflowName: c.workflowName,
    canvasSlug: c.canvasSlug,
    occurrences: c.occurrences,
    lintIssues: c.lintIssues,
    successor: c.successor,
  };
}

/**
 * What we say when neither the table nor the model could explain a failure.
 * Recorded rather than dropped: an unexplained recurring failure is still the
 * most useful thing on the page, and pretending we have a cause would be worse.
 */
function unexplained(c: DoctorCandidate): Diagnosis {
  return {
    fixKind: 'unclassified',
    symptom:
      c.occurrences > 1
        ? `This node has failed ${c.occurrences} times in the last ${WORK_CAPS.lookbackDays} days.`
        : 'This node failed and nothing here can say why.',
    cause: 'No rule matched this error and no explanation could be obtained for it.',
    fix: 'Open the canvas and run this node on its own — the full error is longer than the recorded signature.',
    causeSource: 'signature',
    confident: false,
  };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

function syncBudget(data: DoctorRunData, budget: Budget): void {
  data.llmCalls = budget.llmCalls;
  data.tokensIn = budget.tokensIn;
  data.tokensOut = budget.tokensOut;
  data.costUsd = Number(budget.costUsd.toFixed(4));
}

/**
 * Every outcome count is derived from the action list, never incremented
 * alongside it. The WhatsApp summary reads the counts and names the canvases
 * off the actions, so the two must be the same fact.
 */
function syncCounters(data: DoctorRunData): void {
  const n = (kind: DoctorActionKind) => data.actions.filter((a) => a.kind === kind).length;
  data.fixesApplied = n('fix_applied');
  data.fixesReverted = n('fix_reverted');
  data.fixesRefusedSensitive = n('fix_refused_sensitive');
  data.schedulesQuarantined = n('schedule_quarantined');
  data.proposalsOpened = n('proposal');
}

async function safePersist(runId: string, data: DoctorRunData): Promise<void> {
  try {
    await upsertRecord(COLLECTIONS.doctorRuns, { key: runId, data: asData(data) }, SYSTEM_ACTOR);
  } catch (err) {
    console.error('[workflowdoctor] run persist failed:', errMsg(err));
  }
}

function freshRunData(trigger: 'cron' | 'manual', startedAt: Date): DoctorRunData {
  return {
    status: 'running',
    trigger,
    startedAt: startedAt.toISOString(),
    phases: emptyPhases(),
    llmCalls: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    workflowsFailing: 0,
    signaturesSeen: 0,
    autoApplyEnabled: false,
    breakerEnabled: false,
    fixesApplied: 0,
    fixesReverted: 0,
    fixesRefusedSensitive: 0,
    schedulesQuarantined: 0,
    proposalsOpened: 0,
    findingsResolved: 0,
    whatsappDelivered: false,
    actions: [],
    report: '',
  };
}

/**
 * Read both switches. Fails CLOSED on a settings error: if we cannot tell
 * whether we are allowed to write, we are not allowed to write.
 */
async function readSwitches(): Promise<{ autoApply: boolean; breaker: boolean }> {
  try {
    // Inverted house semantics: only an explicit `true` permits a node write.
    const autoApply = (await getSetting<boolean>(SETTINGS_AUTOAPPLY_KEY)) === true;
    // House semantics: the breaker is on unless explicitly switched off.
    const breaker = (await getSetting<boolean>(SETTINGS_BREAKER_KEY)) !== false;
    return { autoApply, breaker };
  } catch (err) {
    console.error('[workflowdoctor] switch read failed — running propose-only:', errMsg(err));
    return { autoApply: false, breaker: false };
  }
}

/**
 * Execute one doctor run end-to-end. Rejects only if a run is already in
 * progress (overlap guard). Everything else is captured on the run record.
 */
/**
 * Execute one doctor run end to end.
 *
 * Returns the run record as well as its id (it used to return only the id):
 * the `daydream-doctor` heartbeat activity summarises the night onto its pulse
 * and cannot do that from an id alone, and re-reading the datastore record it
 * has just written would be a second query racing the first.
 */
export async function runDoctorNow(
  opts?: { trigger?: 'manual' | 'cron' },
): Promise<{ runId: string; data: DoctorRunData }> {
  const trigger = opts?.trigger ?? 'manual';
  if (!acquireRunLock()) {
    throw new Error('a workflow doctor run is already in progress');
  }

  const runId = crypto.randomUUID();
  lastRunId = runId;
  const startedAt = new Date();
  const budget = createBudget();
  const data = freshRunData(trigger, startedAt);
  let locked = false;

  try {
    // Manual runs may fire before the boot seed on a cold process. Idempotent.
    try {
      await ensureDoctorCollections();
    } catch (err) {
      console.error('[workflowdoctor] ensureDoctorCollections failed:', errMsg(err));
    }
    await safePersist(runId, data);

    // Cron initial idle gate — a manual "Run now" deliberately bypasses this.
    if (trigger === 'cron' && (await isUserActive(IDLE_WINDOW_MS))) {
      data.status = 'aborted_user_active';
      for (const name of Object.keys(data.phases) as PhaseName[]) {
        data.phases[name] = { status: 'skipped', detail: 'user active at start' };
      }
      data.finishedAt = new Date().toISOString();
      data.report = 'Skipped: user was active when the nightly run was due.';
      await safePersist(runId, data);
      return { runId, data };
    }

    // Cross-process rail. Losing it DEGRADES the run to propose-only rather than
    // aborting it: node-postgres pools connections, so an unlock can land on a
    // different connection than the lock did and leave the lane held — and a
    // leaked lane must cost us the write path, not the whole nightly report.
    locked = await tryAdvisoryLock(DOCTOR_LOCK_LANE);
    if (!locked) {
      console.warn(
        `[workflowdoctor] advisory lock ${DOCTOR_LOCK_LANE} unavailable — running propose-only`,
      );
    }

    const { autoApply, breaker } = await readSwitches();
    // Snapshot the EFFECTIVE values, not the switches: a night that could not
    // write because it lost the lock is a shadow night, and the page must say so.
    data.autoApplyEnabled = autoApply && locked;
    data.breakerEnabled = breaker && locked;

    let stop: 'budget' | 'time' | 'user' | null = null;
    const state: {
      triage: TriageResult | null;
      lints: Map<string, WorkflowLint>;
      candidates: DoctorCandidate[];
      diagnosed: DiagnosedCandidate[];
      names: Map<string, string>;
      touched: Set<string>;
      written: Set<string>;
    } = {
      triage: null,
      lints: new Map(),
      candidates: [],
      diagnosed: [],
      names: new Map(),
      touched: new Set(),
      written: new Set(),
    };

    const phases: Array<[Exclude<PhaseName, 'report'>, () => Promise<DoctorAction[]>]> = [
      [
        'gather',
        async () => {
          const t = await triageNow();
          state.triage = t;
          data.workflowsFailing = t.workflowsFailing;
          data.signaturesSeen = t.signatures.length;
          for (const s of t.signatures) state.names.set(s.workflowId, s.workflowName);
          for (const d of t.deadNodeTypes) state.names.set(d.workflowId, d.workflowName);
          for (const r of t.runaways) state.names.set(r.workflowId, r.workflowName);
          // Counts only. The signatures themselves are redacted but the run
          // record is a republishing surface, so the audit line stays numeric.
          return [
            {
              kind: 'triaged',
              detail:
                `${t.workflowsFailing} workflow(s) failing over ${WORK_CAPS.lookbackDays}d, ` +
                `${t.signatures.length} signature(s), ${t.deadNodeTypes.length} dead node type(s), ` +
                `${t.runaways.length} runaway schedule(s), ${t.silentFailures.length} silently-failing run(s)`,
            },
          ];
        },
      ],
      [
        'lint',
        async () => {
          const ids = [...state.names.keys()].slice(0, WORK_CAPS.maxWorkflowsTriaged);
          state.lints = await lintWorkflows(ids);
          let errors = 0;
          let warnings = 0;
          for (const l of state.lints.values()) {
            errors += l.errorCount;
            warnings += l.warningCount;
          }
          // Built here rather than in gather: a candidate carries its node's lint
          // slice, and the classifier is far stronger with it than without.
          state.candidates = state.triage
            ? buildCandidates(state.triage, state.lints).filter(worthReporting)
            : [];
          return [
            {
              kind: 'lint_only',
              detail: `linted ${state.lints.size}/${ids.length} workflow(s): ${errors} error(s), ${warnings} warning(s); ${state.candidates.length} candidate(s) worth reporting`,
            },
          ];
        },
      ],
      [
        'diagnose',
        async () => {
          const actions: DoctorAction[] = [];
          let llmUsed = 0;
          for (const c of state.candidates) {
            const input = classifyInputOf(c);
            let d = classifySignature(input) as Diagnosis | null;
            if (
              !d &&
              llmUsed < WORK_CAPS.maxDiagnoses &&
              budget.timeLeftMs() > WORK_CAPS.reserveWallMs
            ) {
              llmUsed++;
              // Re-throws BudgetExceededError; everything else it swallows.
              d = await diagnoseWithLlm(budget, input);
            }
            const diagnosis = d ?? unexplained(c);
            state.diagnosed.push({ candidate: c, diagnosis });
            actions.push({
              kind: 'diagnosed',
              detail: `${subjectOf(c)} — ${diagnosis.fixKind} via ${diagnosis.causeSource} (${c.occurrences} failure(s))`,
            });
          }
          return actions;
        },
      ],
      [
        'fix',
        async () => {
          const actions: DoctorAction[] = [];

          // The breaker first and on its own switch: it flips one boolean on
          // workflow_schedules, touches no node config, and so cannot reach the
          // audit-log republish path at all.
          const runaways = state.triage?.runaways ?? [];
          if (runaways.length) {
            const q = await quarantineRunaways(runaways, {
              runId,
              enabled: data.breakerEnabled,
            });
            actions.push(...q.actions);
            // A quarantine finding is keyed on the SCHEDULE, not on any node, so
            // it never collides with a candidate — but it still has to be in the
            // seen set or the sweep resolves it the moment it is written.
            for (const o of q.outcomes) if (o.findingKey) state.written.add(o.findingKey);
          }

          // Only the whitelist, and only where the diagnosis named the specific
          // defect rather than its family. fix.ts re-checks all of this behind
          // nine more rails; this just spares it the reads. A run-level failure
          // has no node to patch.
          const eligible: FixCandidate[] = state.diagnosed
            .filter(
              (d) =>
                d.candidate.nodeId !== null &&
                d.diagnosis.confident &&
                AUTO_APPLY_KINDS.includes(d.diagnosis.fixKind),
            )
            .map(({ candidate: c, diagnosis: d }) => ({
              workflowId: c.workflowId,
              workflowName: c.workflowName,
              canvasSlug: c.canvasSlug,
              nodeId: c.nodeId as string,
              nodeType: c.nodeType,
              nodeLabel: c.nodeLabel,
              fixKind: d.fixKind,
              signature: c.signature,
              occurrences: c.occurrences,
              symptom: d.symptom,
              cause: d.cause,
              causeSource: d.causeSource,
              fix: d.fix,
              lintIssues: c.lintIssues,
            }));

          if (eligible.length) {
            const f = await applyFixes(eligible, { runId, enabled: data.autoApplyEnabled });
            actions.push(...f.actions);
            for (const o of f.outcomes) {
              if (FIX_OWNS_FINDING.has(o.status)) state.written.add(o.findingKey);
              if (FIX_MUTATED.has(o.status)) state.touched.add(o.workflowId);
            }
          }

          return actions;
        },
      ],
      [
        'verify',
        async () => {
          const ids = [...state.touched];
          if (!ids.length) return [];
          // Whole-graph confirmation on top of fix.ts's own per-fix revert: the
          // per-fix check only sees the node it touched.
          const after = await lintWorkflows(ids);
          const actions: DoctorAction[] = [];
          for (const id of ids) {
            const before = state.lints.get(id)?.errorCount;
            const now = after.get(id)?.errorCount;
            if (before === undefined || now === undefined) continue;
            state.lints.set(id, after.get(id) as WorkflowLint);
            actions.push({
              kind: 'lint_only',
              detail:
                `${state.names.get(id) ?? id}: lint errors ${before} → ${now}` +
                (now > before ? ' — WORSE after the fix, check the revert' : ''),
            });
          }
          return actions;
        },
      ],
      [
        'propose',
        async () => {
          const actions: DoctorAction[] = [];
          const seen = new Set<string>(state.written);

          for (const { candidate: c, diagnosis: d } of state.diagnosed) {
            const key = findingKey(c.workflowId, c.nodeId, c.signature);
            seen.add(key);
            // The fix phase already owns this record — it holds the before-image
            // and the verify numbers, and re-writing it here would drop them.
            if (state.written.has(key)) continue;

            // `upsertFinding` ADDS to the running total, but our window is 7 days
            // and it overlaps every night. Store the increase only, so the total
            // tracks the high-water mark of observed failures rather than
            // multiplying 5,053 by the number of nights we have been watching.
            const existing = await getFinding(key);
            const delta = Math.max(0, c.occurrences - (existing?.occurrences ?? 0));

            const shadowed = AUTO_APPLY_KINDS.includes(d.fixKind) && !data.autoApplyEnabled;
            await upsertFinding({
              workflowId: c.workflowId,
              workflowName: c.workflowName,
              canvasSlug: c.canvasSlug,
              nodeId: c.nodeId,
              nodeType: c.nodeType,
              nodeLabel: c.nodeLabel,
              signature: c.signature,
              fixKind: d.fixKind,
              status: 'proposed',
              occurrences: delta,
              symptom: d.symptom,
              cause: d.cause,
              causeSource: d.causeSource,
              fix: d.fix,
              lintIssues: c.lintIssues.map((i) => ({
                field: i.field,
                issue: i.issue,
                severity: i.severity,
              })),
              runId,
            });

            actions.push({
              kind: 'proposal',
              detail: `${subjectOf(c)} — ${d.fixKind}: ${d.fix}`,
              story: {
                subject: subjectOf(c),
                symptom: d.symptom,
                symptomEvidence: c.signature,
                occurrences: c.occurrences,
                cause: d.cause,
                causeSource: d.causeSource,
                fix: d.fix,
                fixMode: 'propose-only',
                outcome: shadowed
                  ? 'Not applied: auto-apply is off, so tonight this was recorded as a proposal.'
                  : 'Nothing was changed — this one needs a human.',
                outcomeKind: 'unproven',
              },
            });
          }

          // ── Into the fault ledger ────────────────────────────────────
          //
          // The fold. A finding a human has to write code for becomes an
          // ordinary daydream fault, which is the door self-improvement
          // already reads first — so the doctor stops being a second engine
          // with its own private conclusions and starts feeding the same
          // queue as everything else. `shouldEscalate` keeps the doctor's own
          // lanes out of it: a config edit it can make itself and a runaway
          // the breaker already stopped are not work for anyone.
          const escalated = await escalateFindings(
            state.diagnosed.map(({ candidate: c, diagnosis: d }) => ({
              workflowId: c.workflowId,
              workflowName: c.workflowName,
              nodeId: c.nodeId,
              nodeType: c.nodeType,
              nodeLabel: c.nodeLabel,
              fixKind: d.fixKind,
              occurrences: c.occurrences,
              symptom: d.symptom,
              cause: d.cause,
              fix: d.fix,
            })),
          );
          if (escalated.length) {
            actions.push({
              kind: 'escalated',
              detail: `${escalated.length} finding(s) escalated to the fault ledger for a code change: ${escalated.slice(0, 3).join('; ')}`,
            });
          }

          // The only way a fixed problem stops being reported: its signature
          // stopped arriving. Human verdicts are left alone by the sweep.
          const resolved = await resolveStaleFindings(seen, runId);
          data.findingsResolved = resolved;
          if (resolved > 0) {
            actions.push({
              kind: 'finding_resolved',
              detail: `${resolved} finding(s) no longer seen in the window — marked resolved`,
            });
          }
          return actions;
        },
      ],
    ];

    for (const [name, fn] of phases) {
      if (stop) {
        data.phases[name] = { status: 'skipped', detail: `stopped after ${stop} limit` };
        continue;
      }
      // Between-phase gates. The reserve is what guarantees the report phase its
      // minute — without it one long diagnose loop takes the night silent.
      if (budget.timeLeftMs() < WORK_CAPS.reserveWallMs) {
        stop = 'time';
        data.phases[name] = { status: 'skipped', detail: 'wall-clock cap reached' };
        continue;
      }
      if (trigger === 'cron' && (await isUserActive(IDLE_WINDOW_MS))) {
        stop = 'user';
        data.phases[name] = { status: 'skipped', detail: 'user became active mid-run' };
        continue;
      }

      const t0 = Date.now();
      try {
        const actions = await fn();
        data.actions.push(...actions);
        data.phases[name] = { status: 'ok', ms: Date.now() - t0 };
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          stop = 'budget';
          data.phases[name] = { status: 'failed', detail: 'budget exceeded', ms: Date.now() - t0 };
        } else {
          data.phases[name] = {
            status: 'failed',
            detail: errMsg(err).slice(0, 300),
            ms: Date.now() - t0,
          };
        }
      }
      syncBudget(data, budget);
      syncCounters(data);
      await safePersist(runId, data);
    }

    // Determine overall status.
    syncBudget(data, budget);
    syncCounters(data);
    data.finishedAt = new Date().toISOString();
    if (stop === 'user') data.status = 'aborted_user_active';
    else if (stop === 'budget' || budget.exceeded) data.status = 'budget_exceeded';
    else {
      const anyFailed = (
        ['gather', 'lint', 'diagnose', 'fix', 'verify', 'propose'] as PhaseName[]
      ).some((n) => data.phases[n].status === 'failed');
      data.status = anyFailed ? 'partial' : 'complete';
    }

    // Report phase: build text, persist final record, WhatsApp summary.
    data.phases.report = { status: 'ok' };
    try {
      await finalizeAndNotify(runId, data);
    } catch (err) {
      data.phases.report = { status: 'failed', detail: errMsg(err).slice(0, 300) };
      await safePersist(runId, data);
    }

    return { runId, data };
  } catch (err) {
    // Top-level surprise — capture as `failed`, never rethrow into the scheduler.
    console.error('[workflowdoctor] run failed:', errMsg(err));
    data.status = 'failed';
    data.finishedAt = new Date().toISOString();
    data.report = `Run failed: ${errMsg(err)}`;
    syncBudget(data, budget);
    syncCounters(data);
    await safePersist(runId, data);
    return { runId, data };
  } finally {
    if (locked) await releaseAdvisoryLock(DOCTOR_LOCK_LANE);
    releaseRunLock();
  }
}
