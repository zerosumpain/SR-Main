// src/lib/workflowdoctor/triage.ts
//
// GATHER phase: the cross-workflow failure query, which does not exist anywhere
// else. `/api/canvas/[slug]/stats/errors` answers "what is failing on THIS
// canvas" and the heartbeat review answers "what happened in THIS run"; nobody
// asks "what is failing across all of them". That gap is the whole reason
// 5,053 identical `No executor found for node type: icloud-cal` failures piled
// up on a */5 cron before a human noticed.
//
// Everything here is read-only and bounded, because the report page calls
// `triageNow()` on load. Every write — quarantine, config patch — lives in
// fix.ts.

import { and, desc, eq, gte, inArray, isNotNull, ne, notLike, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '$lib/db';
import {
  nodeExecutions,
  workflowNodes,
  workflowRuns,
  workflowSchedules,
  workflows,
} from '$lib/db/schema';
import { extractSignature } from '$lib/canvas/stats/errorSignature';
import { redactSensitive } from '$lib/security/sensitive';
import { WORK_CAPS } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const CANVAS_PREFIX = 'canvas:';

/**
 * Rows pulled per failure query. The ranking survives the cap (rows arrive
 * newest first); exact counts on a pathological night do not, which is what
 * `truncated` is for. The breaker exists so a pathological night cannot recur.
 */
const MAX_FAILURE_ROWS = 5000;
const MAX_SILENT_ROWS = 200;
const MAX_EXAMPLES = 3;
const MAX_EXAMPLE_CHARS = 240;

/** A schedule failing ten DIFFERENT ways is flaky infrastructure, not a broken definition. */
const BREAKER_DOMINANCE = 0.8;

/** Below this, a named successor is a guess wearing the clothes of evidence. */
const MIN_SUCCESSOR_CONFIDENCE = 0.35;

/** A run that reached either of these did work; the schedule is not runaway. */
const SUCCESS_STATUSES = ['completed', 'completed_with_errors'];

/** Sub-workflow runs surface through their parent (run-notifications.ts:129). */
const SUB_RUN_PREFIX = 'sub-';

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

type NoiseMatch = 'prefix' | 'exact' | 'contains';

/**
 * Infrastructure noise, not workflow defects: the heartbeat reaper, an explicit
 * human cancel, and the drain every deploy performs. Declared once and compiled
 * into BOTH the SQL pre-filter and the JS predicate, because two hand-written
 * copies of the same list are two lists that will disagree within a month.
 *
 * None of these literals contains a LIKE metacharacter (`%`, `_`), so they are
 * safe to interpolate into a pattern unescaped. Keep it that way.
 */
const NOISE_ERRORS: ReadonlyArray<{ match: NoiseMatch; text: string }> = [
  { match: 'prefix', text: 'abandoned: heartbeat stale' },
  { match: 'exact', text: 'Cancelled by user' },
  { match: 'contains', text: 'aborted: run cancelled' },
  { match: 'contains', text: 'Engine is shutting down (draining)' },
];

/** True when this failure tells us about the engine, not about the workflow. */
export function isInfraNoise(runId: string, error: string | null | undefined): boolean {
  if (runId.startsWith(SUB_RUN_PREFIX)) return true;
  const e = (error ?? '').trim();
  if (!e) return true;
  return NOISE_ERRORS.some(({ match, text }) =>
    match === 'exact' ? e === text : match === 'prefix' ? e.startsWith(text) : e.includes(text),
  );
}

/** The same list as `isInfraNoise`, pushed into the query so the cap sees signal. */
function noiseFilters(errorCol: AnyPgColumn, runIdCol: AnyPgColumn): SQL[] {
  const out: SQL[] = NOISE_ERRORS.map(({ match, text }) =>
    match === 'exact'
      ? ne(errorCol, text)
      : notLike(errorCol, match === 'prefix' ? `${text}%` : `%${text}%`),
  );
  out.push(notLike(runIdCol, `${SUB_RUN_PREFIX}%`));
  return out;
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

export type TriageLevel = 'run' | 'node';

/** One qualifying failure, flattened from either the run or the node table. */
export interface FailureRow {
  runId: string;
  workflowId: string;
  workflowName: string;
  level: TriageLevel;
  nodeId: string | null;
  nodeType: string | null;
  nodeLabel: string | null;
  error: string | null;
  /** ISO. */
  at: string;
}

export interface TriageSignature {
  workflowId: string;
  workflowName: string;
  canvasSlug: string | null;
  level: TriageLevel;
  nodeId: string | null;
  nodeType: string | null;
  nodeLabel: string | null;
  /** Safe to render. NEVER safe on WhatsApp — that message carries counts only. */
  signature: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  lastRunId: string;
  /** `count >= minOccurrences`. Below-threshold rows are flagged, not dropped. */
  actionable: boolean;
  /** Up to 3 recent redacted error strings for the report page's `.err-line`. */
  examples: string[];
}

export interface FailureTriage {
  signatures: TriageSignature[];
  /** Distinct workflows with >=1 qualifying failure, counted BEFORE any cap. */
  workflowsFailing: number;
  /** Qualifying failure rows seen (post-noise, pre-cap). */
  totalFailures: number;
  /** True when a row cap bit, in which case every count is a lower bound. */
  truncated: boolean;
}

/** `canvas:morning-briefing` → `morning-briefing`; anything else → null. */
export function canvasSlugOf(name: string): string | null {
  return name.startsWith(CANVAS_PREFIX) ? name.slice(CANVAS_PREFIX.length) : null;
}

/**
 * Redact BEFORE extracting, against the letter of types.ts.
 *
 * `extractSignature` truncates at 80 characters. Redacting afterwards would let
 * a credential that straddles the cut survive as a 12-character prefix that no
 * pattern in $lib/security/sensitive matches any more. Redacting first also
 * collapses two failures that differ only by the secret into one group, which
 * is the grouping we want anyway.
 */
export function signatureOf(error: string | null | undefined): string {
  return extractSignature(redactSensitive(String(error ?? '')));
}

export interface GroupOptions {
  minOccurrences?: number;
  maxSignatures?: number;
  maxWorkflows?: number;
}

/**
 * Group qualifying failures on **(workflowId, nodeId, signature)**.
 *
 * Never on signature alone: the 80-char truncation makes every
 * `Prompt template references unresolved: …` error collide into one string, and
 * a signature-only grouping would then attribute a fix to whichever node
 * happened to be first.
 */
export function groupFailures(
  rows: FailureRow[],
  opts: GroupOptions = {},
): { signatures: TriageSignature[]; workflowsFailing: number; totalFailures: number } {
  const minOccurrences = opts.minOccurrences ?? WORK_CAPS.minOccurrences;
  const maxSignatures = opts.maxSignatures ?? WORK_CAPS.maxSignatures;
  const maxWorkflows = opts.maxWorkflows ?? WORK_CAPS.maxWorkflowsTriaged;

  const groups = new Map<string, TriageSignature>();
  const perWorkflow = new Map<string, number>();
  let totalFailures = 0;

  for (const r of rows) {
    if (isInfraNoise(r.runId, r.error)) continue;
    const signature = signatureOf(r.error);
    if (!signature) continue;

    totalFailures++;
    perWorkflow.set(r.workflowId, (perWorkflow.get(r.workflowId) ?? 0) + 1);

    // NUL is not legal in a Postgres text column, so it cannot appear inside any
    // of the three parts and cannot forge a key boundary.
    const key = `${r.workflowId}\u0000${r.nodeId ?? 'run'}\u0000${signature}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        workflowId: r.workflowId,
        workflowName: r.workflowName,
        canvasSlug: canvasSlugOf(r.workflowName),
        level: r.level,
        nodeId: r.nodeId,
        nodeType: r.nodeType,
        nodeLabel: r.nodeLabel,
        signature,
        count: 0,
        firstSeen: r.at,
        lastSeen: r.at,
        lastRunId: r.runId,
        actionable: false,
        examples: [],
      };
      groups.set(key, g);
    }
    g.count++;
    if (r.at < g.firstSeen) g.firstSeen = r.at;
    if (r.at >= g.lastSeen) {
      g.lastSeen = r.at;
      g.lastRunId = r.runId;
    }
    if (g.examples.length < MAX_EXAMPLES) {
      g.examples.push(redactSensitive(r.error ?? '').slice(0, MAX_EXAMPLE_CHARS));
    }
  }

  // Triage the noisiest workflows, not an arbitrary 25. `workflowsFailing` still
  // reports the true distinct count — that is the number the page is graded on.
  const inScope = new Set(
    [...perWorkflow.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, maxWorkflows)
      .map(([id]) => id),
  );

  const signatures = [...groups.values()]
    .filter((g) => inScope.has(g.workflowId))
    .sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen) || a.signature.localeCompare(b.signature))
    .slice(0, maxSignatures)
    .map((g) => ({ ...g, actionable: g.count >= minOccurrences }));

  return { signatures, workflowsFailing: perWorkflow.size, totalFailures };
}

// ---------------------------------------------------------------------------
// 1. Failure triage
// ---------------------------------------------------------------------------

export interface TriageOptions {
  lookbackDays?: number;
  minOccurrences?: number;
  maxSignatures?: number;
}

function lookbackSince(opts: TriageOptions): Date {
  return new Date(Date.now() - (opts.lookbackDays ?? WORK_CAPS.lookbackDays) * DAY_MS);
}

/**
 * Run-level and node-level failures across EVERY workflow in the window.
 *
 * Both halves are needed and neither subsumes the other: `No executor found for
 * node type: …` is thrown outside the per-node try (engine.ts:417) so it only
 * ever lands on `workflow_runs`, while a credential error lands only on
 * `node_executions` and never sets a run-level error at all.
 */
export async function triageFailures(opts: TriageOptions = {}): Promise<FailureTriage> {
  const since = lookbackSince(opts);

  const runRows = await db
    .select({
      runId: workflowRuns.id,
      workflowId: workflowRuns.workflowId,
      workflowName: workflows.name,
      error: workflowRuns.error,
      startedAt: workflowRuns.startedAt,
      completedAt: workflowRuns.completedAt,
    })
    .from(workflowRuns)
    .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
    .where(
      and(
        eq(workflowRuns.status, 'failed'),
        isNotNull(workflowRuns.error),
        gte(workflowRuns.startedAt, since),
        ...noiseFilters(workflowRuns.error, workflowRuns.id),
      ),
    )
    .orderBy(desc(workflowRuns.startedAt))
    .limit(MAX_FAILURE_ROWS);

  const nodeRows = await db
    .select({
      runId: nodeExecutions.runId,
      workflowId: workflowRuns.workflowId,
      workflowName: workflows.name,
      nodeId: nodeExecutions.nodeId,
      nodeType: workflowNodes.type,
      nodeLabel: workflowNodes.label,
      error: nodeExecutions.error,
      startedAt: workflowRuns.startedAt,
      completedAt: nodeExecutions.completedAt,
    })
    .from(nodeExecutions)
    .innerJoin(workflowRuns, eq(workflowRuns.id, nodeExecutions.runId))
    .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
    .innerJoin(workflowNodes, eq(workflowNodes.id, nodeExecutions.nodeId))
    .where(
      and(
        eq(nodeExecutions.status, 'failed'),
        isNotNull(nodeExecutions.error),
        gte(workflowRuns.startedAt, since),
        ...noiseFilters(nodeExecutions.error, nodeExecutions.runId),
      ),
    )
    .orderBy(desc(nodeExecutions.completedAt))
    .limit(MAX_FAILURE_ROWS);

  const rows: FailureRow[] = [
    ...runRows.map((r) => ({
      runId: r.runId,
      workflowId: r.workflowId,
      workflowName: r.workflowName,
      level: 'run' as const,
      nodeId: null,
      nodeType: null,
      nodeLabel: null,
      error: r.error,
      at: isoOf(r.completedAt ?? r.startedAt),
    })),
    ...nodeRows.map((r) => ({
      runId: r.runId,
      workflowId: r.workflowId,
      workflowName: r.workflowName,
      level: 'node' as const,
      nodeId: r.nodeId,
      nodeType: r.nodeType,
      nodeLabel: r.nodeLabel,
      error: r.error,
      // Watchdog-reaped rows have status='failed' with no completed_at; fall back
      // to the run rather than dropping a real failure on a null timestamp.
      at: isoOf(r.completedAt ?? r.startedAt),
    })),
  ];

  const grouped = groupFailures(rows, opts);
  return {
    ...grouped,
    truncated: runRows.length >= MAX_FAILURE_ROWS || nodeRows.length >= MAX_FAILURE_ROWS,
  };
}

function isoOf(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// ---------------------------------------------------------------------------
// 2. Dead node types
// ---------------------------------------------------------------------------

/** The subset of NodeDefinition the successor search reads. */
export interface SuccessorCandidate {
  type: string;
  label: string;
  description: string;
  llmDescription?: string;
}

export interface DeadNodeType {
  workflowId: string;
  workflowName: string;
  canvasSlug: string | null;
  nodeId: string;
  nodeLabel: string;
  deadType: string;
  /** Named as EVIDENCE for a propose-only finding. Nothing here ever remaps. */
  candidate: string | null;
  candidateConfidence: number;
}

/** `icloud-cal` → ['icloud','cal']; `stealthScrapeLLM` → ['stealth','scrape','llm']. */
export function deadTypeFragments(type: string): string[] {
  return type
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((f) => f.length >= 2);
}

/**
 * How strongly one fragment points at one definition. The ladder is ordered by
 * how much a match means: the type string is the thing that was renamed, the
 * description is prose that happens to mention it.
 */
function fragmentScore(fragment: string, def: SuccessorCandidate): number {
  if (deadTypeFragments(def.type).includes(fragment)) return 3;
  if (def.type.toLowerCase().includes(fragment)) return 2;
  if (def.label.toLowerCase().includes(fragment)) return 1.5;
  if (def.description.toLowerCase().includes(fragment)) return 1;
  if ((def.llmDescription ?? '').toLowerCase().includes(fragment)) return 0.5;
  return 0;
}

/**
 * The single best successor for a retired type, or null.
 *
 * `icloud-cal` scores 0.5 on `apple-calendar` — 'cal' is inside the type and
 * 'icloud' is in the description ("Read and write events on iCloud calendars")
 * — against 0.33 for `api-call` and `llm-call`, which only own the 'cal'.
 *
 * A tie returns null. Two equally plausible successors mean we have named
 * neither, and a coin-flip rendered as evidence is worse than an empty field.
 */
export function pickSuccessor(
  deadType: string,
  candidates: SuccessorCandidate[],
): { candidate: string | null; candidateConfidence: number } {
  const fragments = deadTypeFragments(deadType);
  const none = { candidate: null, candidateConfidence: 0 };
  if (!fragments.length || !candidates.length) return none;

  const scored = candidates
    .filter((d) => d.type !== deadType)
    .map((d) => ({
      type: d.type,
      confidence:
        Math.round((fragments.reduce((s, f) => s + fragmentScore(f, d), 0) / (3 * fragments.length)) * 100) / 100,
    }))
    .sort((a, b) => b.confidence - a.confidence || a.type.localeCompare(b.type));

  const best = scored[0];
  if (!best || best.confidence < MIN_SUCCESSOR_CONFIDENCE) return none;
  if (scored[1] && scored[1].confidence === best.confidence) return none;
  return { candidate: best.type, candidateConfidence: best.confidence };
}

/**
 * Nodes whose `type` is not in the registry — the largest real failure class by
 * two orders of magnitude (5,058 of 5,069 failed runs).
 *
 * Scans EVERY workflow by default, not just the triage set. The two canvases
 * carrying the dead `icloud-cal` nodes had their schedules disabled by hand, so
 * they produce no runs in the window at all: a triage-set-only scan would miss
 * exactly the six nodes this detector exists to find.
 *
 * The registry import is lazy. A static one drags ~130 server node modules into
 * the doctor's module graph and makes every unit test in this directory
 * import-bound.
 */
export async function detectDeadNodeTypes(workflowIds?: string[]): Promise<DeadNodeType[]> {
  const { registry } = await import('$lib/workflows');
  const defs = registry.listDefinitions();
  const known = new Set(defs.map((d) => d.type));

  const rows = await db
    .select({
      workflowId: workflowNodes.workflowId,
      workflowName: workflows.name,
      nodeId: workflowNodes.id,
      nodeLabel: workflowNodes.label,
      type: workflowNodes.type,
    })
    .from(workflowNodes)
    .innerJoin(workflows, eq(workflows.id, workflowNodes.workflowId))
    .where(workflowIds?.length ? inArray(workflowNodes.workflowId, workflowIds) : undefined);

  // One successor search per distinct dead type, not per node.
  const picks = new Map<string, { candidate: string | null; candidateConfidence: number }>();
  const out: DeadNodeType[] = [];

  for (const r of rows) {
    if (known.has(r.type)) continue;

    let pick = picks.get(r.type);
    if (!pick) {
      // `registry.search` splits on whitespace only, so a hyphenated dead type
      // matches nothing on its own — the fragment query is what finds the rename.
      const seen = new Set<string>();
      const candidates: SuccessorCandidate[] = [];
      for (const def of [...registry.search(r.type), ...registry.search(deadTypeFragments(r.type).join(' '))]) {
        // A hidden definition is one that was already superseded; proposing a
        // move to it would be proposing the previous mistake.
        if (def.hidden || seen.has(def.type)) continue;
        seen.add(def.type);
        candidates.push(def);
      }
      pick = pickSuccessor(r.type, candidates);
      picks.set(r.type, pick);
    }

    out.push({
      workflowId: r.workflowId,
      workflowName: r.workflowName,
      canvasSlug: canvasSlugOf(r.workflowName),
      nodeId: r.nodeId,
      nodeLabel: r.nodeLabel,
      deadType: r.type,
      ...pick,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// 3. Runaway schedules — the circuit breaker's detector
// ---------------------------------------------------------------------------

export interface ScheduleRunSample {
  runId: string;
  status: string;
  error: string | null;
}

export interface RunawayVerdict {
  qualifies: boolean;
  /** Plain English, for the finding record when it does NOT qualify too. */
  reason: string;
  signature: string;
  consecutiveFailures: number;
}

export interface RunawaySchedule {
  scheduleId: string;
  workflowId: string;
  workflowName: string;
  canvasSlug: string | null;
  cronExpr: string;
  consecutiveFailures: number;
  signature: string;
  /** Failed runs inside the lookback window — the cost of leaving it enabled. */
  wastedRuns: number;
}

/** The most common string, with its count. Ties resolve to first-seen. */
export function dominantSignature(signatures: string[]): { signature: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const s of signatures) counts.set(s, (counts.get(s) ?? 0) + 1);
  let best: { signature: string; count: number } | null = null;
  for (const [signature, count] of counts) {
    if (!best || count > best.count) best = { signature, count };
  }
  return best;
}

/**
 * Does this schedule qualify for quarantine? All four conditions, or none.
 *
 * The dominance rule is the one that keeps this honest: a canvas that fails ten
 * different ways is telling you the infrastructure wobbled, and disabling its
 * schedule fixes nothing. A canvas that fails the SAME way ten times in a row
 * with no success in between has a broken definition, and every further run is
 * pure waste.
 */
export function evaluateRunaway(
  input: {
    /** The workflow's most recent runs, newest first. */
    recent: ScheduleRunSample[];
    /** Run status → count, inside the lookback window. */
    windowCounts: Record<string, number>;
  },
  opts: { need?: number; dominance?: number } = {},
): RunawayVerdict {
  const need = opts.need ?? WORK_CAPS.breakerConsecutiveFailures;
  const dominance = opts.dominance ?? BREAKER_DOMINANCE;
  const no = (reason: string): RunawayVerdict => ({
    qualifies: false,
    reason,
    signature: '',
    consecutiveFailures: 0,
  });

  const recent = input.recent.slice(0, need);
  if (recent.length < need) {
    return no(`only ${recent.length} run(s) recorded — needs ${need}`);
  }

  const firstSurvivor = recent.findIndex((r) => r.status !== 'failed');
  if (firstSurvivor !== -1) {
    return no(`run ${firstSurvivor + 1} back is ${recent[firstSurvivor].status}, not failed`);
  }

  const succeeded = SUCCESS_STATUSES.reduce((n, s) => n + (input.windowCounts[s] ?? 0), 0);
  if (succeeded > 0) {
    return no(`${succeeded} run(s) succeeded inside the window`);
  }

  // Reaper/cancel/drain rows stay in the denominator but can never BE the
  // dominant signature — otherwise a wedged engine would quarantine a canvas
  // that was never broken.
  const sigs = recent
    .map((r) => (isInfraNoise(r.runId, r.error) ? '' : signatureOf(r.error)))
    .filter(Boolean);
  const dom = dominantSignature(sigs);
  const share = dom ? dom.count / recent.length : 0;
  if (!dom) {
    // Every failure was reaper/cancel/drain noise. Saying "failing 0 different
    // ways" here reads as nonsense in the report; the schedule is not broken,
    // the engine was.
    return no('every recent failure was infrastructure noise, not a canvas defect');
  }
  if (share < dominance) {
    return no(`failing ${new Set(sigs).size} different ways — flaky, not broken`);
  }

  return {
    qualifies: true,
    reason: `${need} consecutive failures, no successes in the window, ${Math.round(share * 100)}% one signature`,
    signature: dom.signature,
    consecutiveFailures: recent.length,
  };
}

/**
 * Cron expression out of a schedule's config.
 *
 * Tolerates both keys for the same reason the scheduler does (scheduler.ts:74-85):
 * the MCP schedule tools historically wrote `config.cron` while the runner only
 * ever read `config.expression`.
 */
export function cronExprOf(config: unknown): string {
  const cfg = (config ?? {}) as Record<string, unknown>;
  if (typeof cfg.expression === 'string' && cfg.expression) return cfg.expression;
  if (typeof cfg.cron === 'string' && cfg.cron) return cfg.cron;
  return '';
}

/**
 * Enabled cron schedules whose workflow is doing nothing but burn runs.
 *
 * Read-only. The write — `workflow_schedules.enabled = false` — is fix.ts's,
 * and the `maxSchedulesQuarantined` cap is applied there, not here: the report
 * should show every runaway even on a night the breaker only quarantines three.
 */
export async function detectRunawaySchedules(opts: TriageOptions = {}): Promise<RunawaySchedule[]> {
  const since = lookbackSince(opts);
  const need = WORK_CAPS.breakerConsecutiveFailures;

  const scheds = await db
    .select({
      scheduleId: workflowSchedules.id,
      workflowId: workflowSchedules.workflowId,
      workflowName: workflows.name,
      config: workflowSchedules.config,
    })
    .from(workflowSchedules)
    .innerJoin(workflows, eq(workflows.id, workflowSchedules.workflowId))
    .where(and(eq(workflowSchedules.enabled, true), eq(workflowSchedules.type, 'cron')));

  if (!scheds.length) return [];
  const ids = [...new Set(scheds.map((s) => s.workflowId))];

  const windowRows = await db
    .select({
      workflowId: workflowRuns.workflowId,
      status: workflowRuns.status,
      n: sql<number>`count(*)::int`,
    })
    .from(workflowRuns)
    .where(
      and(
        inArray(workflowRuns.workflowId, ids),
        gte(workflowRuns.startedAt, since),
        notLike(workflowRuns.id, `${SUB_RUN_PREFIX}%`),
      ),
    )
    .groupBy(workflowRuns.workflowId, workflowRuns.status);

  const windowCounts = new Map<string, Record<string, number>>();
  for (const r of windowRows) {
    const bucket = windowCounts.get(r.workflowId) ?? {};
    bucket[r.status] = Number(r.n);
    windowCounts.set(r.workflowId, bucket);
  }

  // "The last N runs" is not window-bounded — a daily cron that has failed ten
  // times has been failing for ten days, which is longer than the window. One
  // window function does every candidate workflow in a single round trip;
  // per-workflow queries would put 2N of them on a page load.
  const { rows } = await db.execute(sql`
    SELECT t.workflow_id, t.run_id, t.status, t.error
    FROM (
      SELECT r.id AS run_id,
             r.workflow_id,
             r.status,
             r.error,
             row_number() OVER (PARTITION BY r.workflow_id ORDER BY r.started_at DESC) AS rn
      FROM workflow_runs r
      WHERE r.workflow_id = ANY(${ids}::text[])
        AND r.started_at IS NOT NULL
        AND r.id NOT LIKE ${`${SUB_RUN_PREFIX}%`}
    ) t
    WHERE t.rn <= ${need}
    ORDER BY t.workflow_id, t.rn
  `);

  const recent = new Map<string, ScheduleRunSample[]>();
  for (const raw of rows as Array<Record<string, unknown>>) {
    const workflowId = String(raw.workflow_id);
    const list = recent.get(workflowId) ?? [];
    list.push({
      runId: String(raw.run_id),
      status: String(raw.status),
      error: raw.error == null ? null : String(raw.error),
    });
    recent.set(workflowId, list);
  }

  const out: RunawaySchedule[] = [];
  for (const s of scheds) {
    const counts = windowCounts.get(s.workflowId) ?? {};
    const verdict = evaluateRunaway({ recent: recent.get(s.workflowId) ?? [], windowCounts: counts }, { need });
    if (!verdict.qualifies) continue;
    out.push({
      scheduleId: s.scheduleId,
      workflowId: s.workflowId,
      workflowName: s.workflowName,
      canvasSlug: canvasSlugOf(s.workflowName),
      cronExpr: cronExprOf(s.config),
      consecutiveFailures: verdict.consecutiveFailures,
      signature: verdict.signature,
      wastedRuns: counts.failed ?? 0,
    });
  }

  return out.sort((a, b) => b.wastedRuns - a.wastedRuns || a.workflowName.localeCompare(b.workflowName));
}

// ---------------------------------------------------------------------------
// 4. Silent failures
// ---------------------------------------------------------------------------

export interface SilentFailure {
  runId: string;
  workflowId: string;
  workflowName: string;
  canvasSlug: string | null;
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  /** Terminal node's `output_data.status`, when it was numeric and >= 400. */
  httpStatus: number | null;
  /** Redacted `output_data._error`, when the node continued past its own failure. */
  errorText: string | null;
  at: string;
}

/**
 * Runs the status column says succeeded, whose last node did not.
 *
 * Two ways this happens and both report `status='completed'`, `error=NULL`, a
 * 100% success rate, and nothing at all on any existing surface:
 *   - `http-request` never checks `response.ok`, so a 401 is just an output.
 *   - a node with `_onError: continue` writes `{ _error }` and the run carries on.
 *
 * Terminal node only. A mid-graph 404 that a later branch handled is a design,
 * not a defect; what makes this class worth a finding is that the run's RESULT
 * lied.
 */
export async function detectSilentFailures(opts: TriageOptions = {}): Promise<SilentFailure[]> {
  const since = lookbackSince(opts);

  // The predicate is pushed into SQL and only the derived scalars come back:
  // `output_data` can be a large blob and this runs on a page load.
  const { rows } = await db.execute(sql`
    SELECT t.*
    FROM (
      SELECT DISTINCT ON (ne.run_id)
             ne.run_id,
             ne.node_id,
             r.workflow_id,
             w.name AS workflow_name,
             n.type AS node_type,
             n.label AS node_label,
             ne.completed_at,
             CASE WHEN ne.output_data->>'status' ~ '^[0-9]+$'
                  THEN (ne.output_data->>'status')::int END AS http_status,
             jsonb_exists(ne.output_data, '_error') AS has_error,
             left(ne.output_data->>'_error', ${MAX_EXAMPLE_CHARS}) AS error_text
      FROM node_executions ne
      JOIN workflow_runs r ON r.id = ne.run_id
      JOIN workflows w ON w.id = r.workflow_id
      JOIN workflow_nodes n ON n.id = ne.node_id
      WHERE r.status = 'completed'
        AND r.started_at >= ${since.toISOString()}::timestamptz
        AND ne.completed_at IS NOT NULL
        AND ne.run_id NOT LIKE ${`${SUB_RUN_PREFIX}%`}
      ORDER BY ne.run_id, ne.completed_at DESC
    ) t
    WHERE t.http_status >= 400 OR t.has_error
    ORDER BY t.completed_at DESC
    LIMIT ${MAX_SILENT_ROWS}
  `);

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    runId: String(r.run_id),
    workflowId: String(r.workflow_id),
    workflowName: String(r.workflow_name),
    canvasSlug: canvasSlugOf(String(r.workflow_name)),
    nodeId: String(r.node_id),
    nodeType: String(r.node_type),
    nodeLabel: String(r.node_label),
    httpStatus: r.http_status == null ? null : Number(r.http_status),
    errorText: r.error_text == null ? null : redactSensitive(String(r.error_text)),
    at: isoOf(r.completed_at as Date | string | null),
  }));
}

// ---------------------------------------------------------------------------
// 5. Everything, once
// ---------------------------------------------------------------------------

export interface TriageResult {
  signatures: TriageSignature[];
  deadNodeTypes: DeadNodeType[];
  runaways: RunawaySchedule[];
  /** Distinct workflows with >=1 qualifying failure in the window. */
  workflowsFailing: number;
  silentFailures: SilentFailure[];
}

/**
 * The whole gather phase, in one call, for both the run pipeline and the live
 * page load.
 *
 * Read-only and bounded — no LLM, no writes, every query capped — but it can
 * still throw if the database is unreachable. The page load owns that
 * (`triageNow().catch(() => null)`); the run pipeline wants it to throw, so the
 * gather phase is honestly marked failed rather than reporting a clean night.
 */
export async function triageNow(opts: TriageOptions = {}): Promise<TriageResult> {
  const [failures, deadNodeTypes, runaways, silentFailures] = await Promise.all([
    triageFailures(opts),
    detectDeadNodeTypes(),
    detectRunawaySchedules(opts),
    detectSilentFailures(opts),
  ]);

  return {
    signatures: failures.signatures,
    deadNodeTypes,
    runaways,
    workflowsFailing: failures.workflowsFailing,
    silentFailures,
  };
}
