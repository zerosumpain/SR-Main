import { createHash } from 'node:crypto';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, workflowRuns, workflowVersions, nodeExecutions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import { setRunChainDepth } from '$lib/events/platform-bus';
import { isDisplayOnlyType, type WorkflowDefinition } from './types';
import type { EngineResult } from './engine';
import { emitObs } from './observability-bus';
import { finaliseRun, failRun } from './run-finalise';
import { stableStringify } from './fix-proposals.server';

/**
 * The run kernel: the ONE way a run is started, executed and settled.
 *
 * The manual Run button, the scheduler, the webhook route, the event bus, the
 * gmail and whatsapp bridges, canvas chat, the single-node re-run, the
 * `workflow_run` tool (and the native lane through it), sub-workflow children,
 * the run-worker, human resume and crash recovery all come through here. Each
 * used to carry its own copy of "load nodes → shape a definition → insert the
 * run → execute → persist", and the copies had drifted (display-only filtering,
 * the worker switch, pending node rows, pausedAtNodeId, workflow_completed).
 *
 * Every run PINS the definition it started with (`workflow_versions`), so a
 * resume, a recovery after a crash or deploy, or a child run executes that graph
 * rather than whatever the canvas has become since.
 */

/**
 * A definition from the stored nodes/edges. Display-only nodes (sticky notes,
 * annotations) and their edges are dropped unless `includeDisplayOnly` — what a
 * linter or a mapping proposal wants, not what the engine runs.
 */
export async function loadDefinition(
  workflowId: string,
  opts: { includeDisplayOnly?: boolean } = {},
): Promise<WorkflowDefinition | null> {
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
  if (!workflow) return null;
  const nodes = (await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, workflowId)))
    .filter((n) => opts.includeDisplayOnly || !isDisplayOnlyType(n.type));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, workflowId)))
    .filter((e) => ids.has(e.sourceNodeId) && ids.has(e.targetNodeId));
  return {
    id: workflowId,
    name: workflow.name,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      config: (n.config as Record<string, unknown>) ?? {},
      label: n.label ?? n.type,
      position: (n.position as { x: number; y: number }) ?? { x: 0, y: 0 },
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
    })),
  };
}

/**
 * Content hash of what the engine would run. Positions are left out — dragging
 * a node is not a new version — and keys are sorted at every depth, because
 * jsonb hands config back in its own key order.
 *
 * Not the native lane's `graphVersion`: that hashes node version COUNTERS for
 * optimistic concurrency and moves on any write, including ones that change
 * nothing the engine sees. This must change exactly when behaviour can.
 */
export function definitionHash(def: WorkflowDefinition): string {
  const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const canonical = {
    name: def.name,
    nodes: [...def.nodes].sort(byId).map((n) => ({ id: n.id, type: n.type, label: n.label, config: n.config })),
    edges: [...def.edges].sort(byId).map((e) => ({
      id: e.id, s: e.sourceNodeId, t: e.targetNodeId, sh: e.sourceHandle ?? null, th: e.targetHandle ?? null,
    })),
  };
  return createHash('sha256').update(stableStringify(canonical)).digest('hex');
}

/**
 * The version row for this definition, created on first sight. Best-effort: a
 * run whose snapshot could not be written still runs, it just resumes against
 * the live graph (the pre-versioning behaviour).
 */
export async function pinVersion(workflowId: string, def: WorkflowDefinition): Promise<string | null> {
  try {
    const hash = definitionHash(def);
    const find = () => db.select({ id: workflowVersions.id }).from(workflowVersions)
      .where(and(eq(workflowVersions.workflowId, workflowId), eq(workflowVersions.hash, hash))).limit(1);
    const [existing] = await find();
    if (existing) return existing.id;
    const [created] = await db.insert(workflowVersions)
      .values({ workflowId, hash, definition: def })
      .onConflictDoNothing()
      .returning({ id: workflowVersions.id });
    return created?.id ?? (await find())[0]?.id ?? null;
  } catch (err) {
    console.warn(`[start-run] could not pin a version for ${workflowId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** The definition a run is pinned to; the live graph for a run from before versions existed. */
export async function loadPinnedDefinition(run: { workflowId: string; versionId?: string | null }): Promise<WorkflowDefinition | null> {
  if (run.versionId) {
    const [v] = await db.select({ definition: workflowVersions.definition }).from(workflowVersions)
      .where(eq(workflowVersions.id, run.versionId)).limit(1);
    if (v?.definition) return v.definition as WorkflowDefinition;
  }
  return loadDefinition(run.workflowId);
}

export interface ExecuteRunOptions {
  runId: string;
  workflowId: string;
  definition: WorkflowDefinition;
  input: Record<string, unknown>;
  trigger?: string;
  label?: string;
  breakpoints?: Set<string>;
  selfHealing?: boolean;
  dryRun?: boolean;
  chainDepth?: number;
  /** A sub-workflow child: never takes a top-level concurrency slot. */
  parentRunId?: string | null;
  /** Idle + hard watchdogs (interactive starts: chat, re-run, the run tool). */
  watchdog?: boolean;
  /** Resume/recovery: outputs and branch choices already recorded. */
  seed?: { outputs: Record<string, Record<string, unknown>>; handles: Record<string, string> };
  /** Wall-clock the run began (resume keeps the original). */
  runStartedAt?: number;
}

/**
 * Execute an existing run row to completion and settle it through the one
 * finaliser. Never throws; resolves with the engine result, or null when the
 * engine itself threw (already recorded as a failed run).
 */
export async function executeRun(o: ExecuteRunOptions): Promise<EngineResult | null> {
  const label = o.label ?? 'run';
  const runStartedAt = o.runStartedAt ?? Date.now();
  if (o.chainDepth) setRunChainDepth(o.runId, o.chainDepth);
  if (!o.seed) {
    emitObs('run.started', {
      workflowId: o.workflowId,
      runId: o.runId,
      trigger: o.trigger ?? 'manual',
      startedAt: new Date(runStartedAt).toISOString(),
    });
  }
  const disarm = o.watchdog ? (await import('./run-helpers')).armRunWatchdog(o.runId, label) : null;
  try {
    const result = await engine.execute(
      o.definition,
      o.runId,
      o.input,
      o.breakpoints,
      o.workflowId,
      { selfHealing: o.selfHealing, dryRun: o.dryRun, child: !!o.parentRunId },
      o.seed?.outputs,
      o.seed?.handles,
    );
    disarm?.();
    await finaliseRun({
      workflowId: o.workflowId,
      runId: o.runId,
      result,
      runStartedAt,
      chainDepth: o.chainDepth,
      parentRunId: o.parentRunId,
      seededNodeIds: o.seed ? new Set(Object.keys(o.seed.outputs)) : undefined,
      label,
    });
    return result;
  } catch (err) {
    disarm?.();
    console.error(`[${label}] workflow execution threw (runId=${o.runId}):`, err instanceof Error ? err.message : err);
    await failRun({ workflowId: o.workflowId, runId: o.runId, error: err, label });
    return null;
  }
}

export interface StartRunOptions extends Omit<ExecuteRunOptions, 'runId' | 'definition' | 'input' | 'seed' | 'runStartedAt'> {
  input?: Record<string, unknown>;
  trigger: string;
  /** A pre-shaped definition (single-node re-run); otherwise the stored graph. */
  definition?: WorkflowDefinition;
}

export interface StartedRun {
  runId: string;
  status: 'running' | 'pending';
  /** Settles when the run does. Resolves null in worker mode (another process runs it). */
  done: Promise<EngineResult | null>;
}

/**
 * Start a run: load and pin the definition, write the run row and its pending
 * node rows, then enqueue it (worker mode) or execute it in process. Returns
 * once the run exists; execution is NOT awaited — await `done` for that.
 * Null when the workflow no longer exists.
 */
export async function startRun(opts: StartRunOptions): Promise<StartedRun | null> {
  const definition = opts.definition ?? (await loadDefinition(opts.workflowId));
  if (!definition) return null;
  const input = opts.input ?? {};
  const versionId = await pinVersion(opts.workflowId, definition);
  // A child is awaited by its parent's node, so it always runs here.
  const workerMode = process.env.JKAI_RUN_WORKER === '1' && !opts.parentRunId;
  const runId = crypto.randomUUID();
  await db.insert(workflowRuns).values({
    id: runId,
    workflowId: opts.workflowId,
    status: workerMode ? 'pending' : 'running',
    trigger: opts.trigger,
    startedAt: new Date(),
    inputData: input,
    versionId,
    parentRunId: opts.parentRunId ?? null,
  });
  if (definition.nodes.length > 0) {
    await db.insert(nodeExecutions).values(definition.nodes.map((n) => ({ runId, nodeId: n.id, status: 'pending' })));
  }
  if (workerMode) {
    const { enqueue } = await import('./run-queue');
    await enqueue(runId);
    return { runId, status: 'pending', done: Promise.resolve(null) };
  }
  const done = executeRun({ ...opts, runId, definition, input });
  return { runId, status: 'running', done };
}

/** An event, WhatsApp keyword or email started it: a trigger='event' run. */
export async function startTriggeredRun(
  workflowId: string,
  input: Record<string, unknown>,
  opts: { label: string; chainDepth?: number },
): Promise<string | null> {
  return (await startRun({ workflowId, trigger: 'event', input, ...opts }))?.runId ?? null;
}
