import { invokeWorkflowRuntime, decodeEngineResult, type EngineResult, type RemoteStartedRun } from './runtime-client';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { isDisplayOnlyType, type WorkflowDefinition } from './types';
import type { PinnedOutput } from './side-effects';

export type RunMode = 'live' | 'test';

/**
 * Main's door to workflow runs. SR-Workflows loads, executes, pins and settles
 * every run; Main's callers (the event bus, WhatsApp dispatch, monitors and
 * commissions) start them through `startRun` / `startTriggeredRun` here.
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
  /**
   * 'test': pins stand in for their nodes, side effects are stubbed (bar
   * `allowSideEffects`), self-heal is off and nothing is announced. Recorded on
   * the run row, so a resume keeps it. Default 'live'.
   */
  mode?: RunMode;
  pins?: Record<string, PinnedOutput>;
  allowSideEffects?: string[];
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
 * Start through SR-Workflows. Live queued runs acknowledge their durable ID;
 * test/child/draft operations await the owner result before returning a settled
 * `done` promise. A missing workflow returns null; transport errors never fall back.
 */
export async function startRun(opts: StartRunOptions): Promise<StartedRun | null> {
  const started = await invokeWorkflowRuntime<RemoteStartedRun | null>({
    action: 'start', options: { ...opts, breakpoints: opts.breakpoints ? [...opts.breakpoints] : undefined },
  });
  return started ? { runId: started.runId, status: started.status, done: Promise.resolve(decodeEngineResult(started.result)) } : null;
}

/** An event, WhatsApp keyword or email started it: a trigger='event' run. */
export async function startTriggeredRun(
  workflowId: string,
  input: Record<string, unknown>,
  opts: { label: string; chainDepth?: number },
): Promise<string | null> {
  return (await startRun({ workflowId, trigger: 'event', input, ...opts }))?.runId ?? null;
}
