import type {
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowEventType,
  NodeResult,
  ExecutionContext,
  RunStatus,
} from './types';
import type { NodeRegistry } from './registry';
import { buildGraph, topologicalSort } from './graph';
import type { WorkflowGraph } from './graph';
import { emitWorkflowEvent, onWorkflowEvent, cleanupRunEmitter } from './events';
import { diagnoseAndFix } from './orchestrator/healing';
import type { HealingContext, UndoEntry, NodeDefinition, NodeOnErrorConfig } from './types';
import {
  executionContext,
  rollupUsage,
  type LLMCallRecord,
  type NodeExecutionContext,
  type UsageRollup,
} from './execution-context';
import { emitObs } from './observability-bus';
import {
  acquireRunSlot,
  nodeTimeoutMs,
  startHeartbeat,
  withNodeTimeout,
  RunAbortedError,
} from './engine-runtime';
import { db } from '$lib/db';
import { nodeExecutions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { mergeUpstreamInput } from './engine-node-runner';
import { commitDeferredDedupeRecords } from './nodes/dedupe';
import { loadStoreSnapshot } from './nodes/data-store';
import { notifyRunOutcome } from './run-notifications';
import {
  resolveStateTemplatesDeep,
  scanUnknownTemplateVars,
  workflowUsesStateTemplates,
} from './state-templates';

/**
 * Module-level run registry (shared across the singleton engine instance).
 *
 * #11 CANCEL: runId -> AbortController for the run. Aborting this controller
 *   stops scheduling further levels (checked between levels) and aborts every
 *   in-flight per-node timeout controller (linked at node start), which causes
 *   withNodeTimeout to reject and the node to surface as a failure.
 *
 * #10 DRAIN: runId -> the in-flight execute() promise so graceful shutdown can
 *   await outstanding runs (bounded). `draining` makes new execute() calls
 *   no-op cleanly so we don't start fresh work while shutting down.
 */
const runAbortControllers = new Map<string, AbortController>();
const inFlightRuns = new Map<string, Promise<EngineResult>>();
let draining = false;

/** Cancellation error thrown internally when a run is cancelled mid-flight. */
class RunCancelledError extends Error {
  constructor() {
    super('Run cancelled');
    this.name = 'RunCancelledError';
  }
}

/**
 * #20 INCREMENTAL PERSIST: write a node's terminal output/status to its
 * pre-created node_executions row AT COMPLETION (rather than only in the
 * post-run persister). Best-effort and runId-scoped: the UPDATE matches the
 * row pre-created with status 'pending' (run route / scheduler). A no-match
 * UPDATE (e.g. unit tests that never insert rows) is harmless. Never throws —
 * a DB hiccup must not fail the node. The post-run persister still runs and is
 * idempotent (same runId+nodeId .where), so this only moves the write earlier
 * so engine-resume sees completed outputs even if the process dies mid-run.
 */
async function persistNodeCompletion(
  runId: string,
  nodeId: string,
  fields: {
    status: 'completed' | 'failed';
    startedAt?: Date;
    inputData?: Record<string, unknown> | null;
    outputData?: Record<string, unknown> | null;
    error?: string;
    usage?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await db
      .update(nodeExecutions)
      .set({
        status: fields.status,
        startedAt: fields.startedAt ?? undefined,
        ...(fields.inputData !== undefined ? { inputData: fields.inputData } : {}),
        ...(fields.outputData !== undefined ? { outputData: fields.outputData } : {}),
        ...(fields.error !== undefined ? { error: fields.error } : {}),
        completedAt: new Date(),
        ...(fields.usage ?? {}),
      })
      .where(and(eq(nodeExecutions.runId, runId), eq(nodeExecutions.nodeId, nodeId)));
  } catch (e) {
    console.warn(
      `[engine] incremental persist failed run=${runId} node=${nodeId}:`,
      e instanceof Error ? e.message : e,
    );
  }
}

/** Thrown internally by the engine when a node returns a pause sentinel. */
export class PauseForHumanSignal {
  constructor(
    public readonly nodeId: string,
    public readonly interactionId: number,
  ) {}
}

export interface EngineResult {
  status: RunStatus;
  nodeOutputs: Map<string, Record<string, unknown>>;
  nodeInputs: Map<string, Record<string, unknown>>;
  nodeErrors: Map<string, string>;
  /** Per-node LLM cost/token rollup, populated when one or more LLM calls
   *  happened inside the node's execution. Nodes with no LLM calls are
   *  absent (not present with null usage), so the persister can skip
   *  touching the cost columns for non-LLM nodes. */
  nodeUsage: Map<string, UsageRollup>;
  /** When each node began executing — wall-clock. Persisted to
   *  node_executions.started_at so duration (completed_at - started_at)
   *  can be computed. */
  nodeStartTimes: Map<string, Date>;
  error?: string;
  healingHistory?: UndoEntry[];
  /** Populated when the engine paused mid-run for human interaction. */
  pausedAtNodeId?: string;
}

export class WorkflowEngine {
  private breakpointResolvers = new Map<string, (modifiedInput?: Record<string, unknown>) => void>();
  private activeBreakpoints = new Map<string, Set<string>>();

  constructor(private registry: NodeRegistry) {}

  /**
   * #11 CANCEL — abort an in-flight run. Aborts the run-level controller (which
   * also aborts every linked in-flight per-node timeout controller and stops
   * the engine scheduling further levels) and forgets the controller. No-op if
   * the run isn't currently tracked (already settled or never started here).
   * The cancel route calls this AFTER it has written the DB status, so the
   * engine's own post-run persister can't resurrect a 'running' status.
   */
  cancelRun(runId: string): boolean {
    const controller = runAbortControllers.get(runId);
    if (!controller) return false;
    try {
      controller.abort();
    } catch {
      /* noop */
    }
    runAbortControllers.delete(runId);
    return true;
  }

  /**
   * #10 GRACEFUL DRAIN — stop accepting new runs and wait for outstanding ones
   * to settle, bounded by timeoutMs so shutdown can never hang. Sets the
   * module-level `draining` flag (new execute() calls no-op cleanly), then
   * races the outstanding in-flight promises against the timeout. Returns the
   * number of runs that were still in flight when drain began.
   */
  async drain(timeoutMs: number): Promise<number> {
    draining = true;
    const outstanding = Array.from(inFlightRuns.values());
    const count = outstanding.length;
    if (count === 0) return 0;
    console.log(`[engine] draining ${count} in-flight run(s), waiting up to ${Math.round(timeoutMs / 1000)}s`);
    // Promises here are the execute() result promises; they never reject
    // (execute catches internally and resolves with status:'failed'), so
    // Promise.all is safe. Bound with a timeout regardless.
    const allSettled = Promise.all(outstanding).then(() => undefined);
    const timeout = new Promise<undefined>((resolve) => setTimeout(resolve, timeoutMs));
    await Promise.race([allSettled, timeout]);
    const remaining = inFlightRuns.size;
    if (remaining > 0) {
      console.warn(`[engine] drain timed out with ${remaining} run(s) still in flight`);
    } else {
      console.log('[engine] drain complete — all in-flight runs settled');
    }
    return count;
  }

  setBreakpoints(runId: string, nodes: Set<string>): void {
    this.activeBreakpoints.set(runId, nodes);
  }

  resumeBreakpoint(runId: string, nodeId: string, modifiedInput?: Record<string, unknown>): void {
    const key = `${runId}:${nodeId}`;
    const resolver = this.breakpointResolvers.get(key);
    if (resolver) {
      resolver(modifiedInput);
      this.breakpointResolvers.delete(key);
    }
  }

  getBreakpointResolver(runId: string, nodeId: string): ((data?: Record<string, unknown>) => void) | undefined {
    return this.breakpointResolvers.get(`${runId}:${nodeId}`);
  }

  onEvent(runId: string, handler: (event: WorkflowEvent) => void): () => void {
    return onWorkflowEvent(runId, handler);
  }

  private markSkipped(
    nodeId: string,
    graph: WorkflowGraph,
    skippedNodes: Set<string>,
    blockedEdgeIds: Set<string>,
  ): void {
    if (skippedNodes.has(nodeId)) return;

    // A node is skipped only if ALL its incoming edges are blocked or come from skipped nodes
    const incomingEdges = graph.edgesByTarget.get(nodeId) || [];
    const hasActiveIncoming = incomingEdges.some(
      (e) => !blockedEdgeIds.has(e.id) && !skippedNodes.has(e.sourceNodeId),
    );
    if (hasActiveIncoming) return;

    skippedNodes.add(nodeId);

    // Recursively skip all downstream nodes (that also have no active incoming)
    const outgoingEdges = graph.edgesBySource.get(nodeId) || [];
    for (const edge of outgoingEdges) {
      // All edges from a skipped node are implicitly blocked
      blockedEdgeIds.add(edge.id);
      this.markSkipped(edge.targetNodeId, graph, skippedNodes, blockedEdgeIds);
    }
  }

  /**
   * Resume a paused run by pre-seeding node outputs for already-completed
   * nodes (including the resolved interactive-step node). The engine's
   * topological walker will skip any node whose output is already present
   * in nodeOutputs.
   */
  async executeWithPreSeededOutputs(
    workflow: WorkflowDefinition,
    runId: string,
    preSeededOutputs: Record<string, Record<string, unknown>>,
    workflowId?: string,
    options?: { selfHealing?: boolean; dryRun?: boolean },
  ): Promise<EngineResult> {
    return this.execute(workflow, runId, {}, undefined, workflowId, options, preSeededOutputs);
  }

  /**
   * Public entry point. Thin wrapper that:
   *  - #10: rejects/no-ops cleanly while draining (returns a failed result so
   *    callers' .then persisters run normally without special-casing),
   *  - #11: registers a run-level AbortController so cancelRun() can reach it,
   *  - #10: tracks the in-flight promise so drain() can await it,
   *  - cleans both up when the run settles.
   * All real work stays in executeInner — control flow / events unchanged.
   */
  async execute(
    workflow: WorkflowDefinition,
    runId: string,
    initialInput: Record<string, unknown>,
    breakpoints?: Set<string>,
    workflowId?: string,
    options?: { selfHealing?: boolean; dryRun?: boolean },
    preSeededOutputs?: Record<string, Record<string, unknown>>,
  ): Promise<EngineResult> {
    if (draining) {
      console.warn(`[engine] refusing run ${runId} — engine is draining for shutdown`);
      return {
        status: 'failed',
        nodeOutputs: new Map(),
        nodeInputs: new Map(),
        nodeErrors: new Map(),
        nodeUsage: new Map(),
        nodeStartTimes: new Map(),
        error: 'Engine is shutting down (draining)',
        healingHistory: [],
      };
    }

    const abortController = new AbortController();
    runAbortControllers.set(runId, abortController);

    const promise = this.executeInner(
      workflow,
      runId,
      initialInput,
      abortController,
      breakpoints,
      workflowId,
      options,
      preSeededOutputs,
    ).finally(() => {
      inFlightRuns.delete(runId);
      runAbortControllers.delete(runId);
    });
    inFlightRuns.set(runId, promise);
    return promise;
  }

  private async executeInner(
    workflow: WorkflowDefinition,
    runId: string,
    initialInput: Record<string, unknown>,
    abortController: AbortController,
    breakpoints?: Set<string>,
    workflowId?: string,
    options?: { selfHealing?: boolean; dryRun?: boolean },
    preSeededOutputs?: Record<string, Record<string, unknown>>,
  ): Promise<EngineResult> {
    const nodeOutputs = new Map<string, Record<string, unknown>>();
    const nodeInputs = new Map<string, Record<string, unknown>>();
    const nodeErrors = new Map<string, string>();
    const nodeUsage = new Map<string, UsageRollup>();
    const nodeStartTimes = new Map<string, Date>();
    const skippedNodes = new Set<string>();
    const blockedEdgeIds = new Set<string>();

    // Pre-seed node outputs for already-completed nodes (resume path).
    if (preSeededOutputs) {
      for (const [id, output] of Object.entries(preSeededOutputs)) {
        nodeOutputs.set(id, output);
      }
    }
    const healingHistory: UndoEntry[] = [];

    // Concurrency cap: queue if MAX_CONCURRENT_RUNS already in-flight. Cheap
    // when under cap, prevents starvation when bursts of webhook + scheduled
    // + manual triggers land in the same minute.
    const releaseSlot = await acquireRunSlot(runId);
    // Heartbeat: writes workflow_runs.heartbeat_at every 10s so the reaper
    // can distinguish a wedged run from a legitimately long-running one.
    const stopHeartbeat = startHeartbeat(runId);

    // Merge breakpoints from setBreakpoints() with those passed directly
    const storedBreakpoints = this.activeBreakpoints.get(runId);
    const effectiveBreakpoints: Set<string> | undefined =
      storedBreakpoints && breakpoints
        ? new Set([...storedBreakpoints, ...breakpoints])
        : storedBreakpoints ?? breakpoints;

    const emit = (type: WorkflowEventType, nodeId?: string, data?: Record<string, unknown>) => {
      emitWorkflowEvent({
        type,
        runId,
        nodeId,
        data,
        timestamp: new Date().toISOString(),
      });
    };

    emit('run_started');

    try {
      const graph = buildGraph(workflow.nodes, workflow.edges);
      const levels = topologicalSort(graph);

      // {{state.KEY}} pre-resolution: load the whole workflow store ONCE at run
      // start, but only if any node actually references `{{state...}}` (keeps
      // DB-free workflows DB-free). Refreshed after each data-store/dedupe write
      // so a later level sees what an earlier one persisted. {{today}}/{{now}}
      // need no snapshot. The snapshot never mutates the persisted node config —
      // resolution produces a per-node copy handed to the executor.
      const effectiveWorkflowId = workflowId ?? workflow.id;
      const needsState = workflowUsesStateTemplates(workflow.nodes);
      let storeSnapshot = new Map<string, unknown>();
      if (needsState) {
        try {
          storeSnapshot = await loadStoreSnapshot(effectiveWorkflowId);
        } catch (e) {
          console.warn(`[engine] state snapshot load failed run=${runId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      const refreshStoreSnapshot = async (nodeType: string): Promise<void> => {
        if (!needsState) return;
        if (nodeType !== 'data-store' && nodeType !== 'dedupe') return;
        try {
          storeSnapshot = await loadStoreSnapshot(effectiveWorkflowId);
        } catch (e) {
          console.warn(`[engine] state snapshot refresh failed run=${runId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      };

      for (const level of levels) {
        // #11 CANCEL: stop scheduling further node levels once the run has been
        // cancelled. In-flight nodes from the previous level have already been
        // aborted (their per-node controllers fired); we simply don't dispatch
        // the next level. The final status falls out as 'failed' /
        // 'completed_with_errors' from whatever nodeErrors were recorded.
        if (abortController.signal.aborted) {
          console.warn(`[engine] run ${runId} cancelled — halting before next level`);
          break;
        }

        const promises = level.map(async (nodeId) => {
          // If this node is skipped, emit event and skip execution
          if (skippedNodes.has(nodeId)) {
            emit('node_skipped', nodeId);
            return;
          }

          // If this node's output was pre-seeded (resume path), skip re-execution.
          if (nodeOutputs.has(nodeId)) {
            return;
          }

          const nodeDef = graph.nodeMap.get(nodeId)!;
          const executor = this.registry.getExecutor(nodeDef.type);

          if (!executor) {
            throw new Error(`No executor found for node type: ${nodeDef.type}`);
          }

          // Gather input from upstream nodes (only non-skipped sources).
          // #13: extracted verbatim to engine-node-runner.mergeUpstreamInput.
          let mergedInput: Record<string, unknown> = mergeUpstreamInput(
            nodeId,
            runId,
            graph,
            nodeOutputs,
            skippedNodes,
            initialInput,
          );

          // Check breakpoint
          if (effectiveBreakpoints?.has(nodeId)) {
            emit('breakpoint_hit', nodeId, mergedInput);
            emit('node_paused', nodeId);
            mergedInput = await new Promise<Record<string, unknown>>((resolve) => {
              const key = `${runId}:${nodeId}`;
              this.breakpointResolvers.set(key, (modifiedInput) => resolve(modifiedInput ?? mergedInput));
            });
          }

          // Capture input before execution
          nodeInputs.set(nodeId, { ...mergedInput });

          const nodeStartedAt = Date.now();
          nodeStartTimes.set(nodeId, new Date(nodeStartedAt));
          emit('node_started', nodeId);
          emitObs('node.started', {
            workflowId: workflowId ?? workflow.id,
            runId,
            nodeId,
            startedAt: new Date(nodeStartedAt).toISOString(),
          });

          // Per-node LLM telemetry capture. The gateway wrapper (Phase 2)
          // pushes one record per chat-completion call into `llmCalls` via
          // AsyncLocalStorage. drain() rolls up totals and stores them on
          // the engine result so run-helpers / scheduler can persist the
          // cost columns. drain() is called at every exit path below
          // (success, on-error continue, on-error route, self-healing
          // success, self-healing failure, thrown error before healing).
          const llmCalls: LLMCallRecord[] = [];
          const execCtx: NodeExecutionContext = {
            workflowId: workflowId ?? workflow.id,
            runId,
            nodeId,
            llmCalls,
          };
          let drained = false;
          const drain = () => {
            if (drained) return;
            drained = true;
            const rollup = rollupUsage(llmCalls);
            if (rollup) nodeUsage.set(nodeId, rollup);
          };
          // Set after the per-node abort listener is registered (below); the
          // finish helpers call it so we don't leak listeners on the run-level
          // controller across the lifetime of a long run.
          let cleanupNodeAbort = () => {};
          const finishNodeOk = () => {
            drain();
            cleanupNodeAbort();
            const u = nodeUsage.get(nodeId);
            emitObs('node.completed', {
              workflowId: workflowId ?? workflow.id,
              runId,
              nodeId,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - nodeStartedAt,
              costUsd: u?.costUsd ? Number(u.costUsd) : null,
              tokensInput: u?.tokensInput ?? null,
              tokensOutput: u?.tokensOutput ?? null,
            });
            // #20 INCREMENTAL PERSIST: write the node's completed output to its
            // node_executions row now (best-effort, fire-and-forget). The
            // post-run persister re-writes the same runId+nodeId row idempotently.
            void persistNodeCompletion(runId, nodeId, {
              status: 'completed',
              startedAt: nodeStartTimes.get(nodeId),
              inputData: nodeInputs.get(nodeId) ?? null,
              outputData: nodeOutputs.get(nodeId) ?? null,
              usage: u as Record<string, unknown> | undefined,
            });
          };
          const finishNodeFailed = (error: string) => {
            drain();
            cleanupNodeAbort();
            emitObs('node.failed', {
              workflowId: workflowId ?? workflow.id,
              runId,
              nodeId,
              completedAt: new Date().toISOString(),
              error,
            });
            // #20 INCREMENTAL PERSIST: write the failure to its row now.
            void persistNodeCompletion(runId, nodeId, {
              status: 'failed',
              startedAt: nodeStartTimes.get(nodeId),
              error,
              usage: nodeUsage.get(nodeId) as Record<string, unknown> | undefined,
            });
          };

          // Per-node abort controller. Its own timeout (via withNodeTimeout)
          // aborts THIS controller only, so a single node's timeout no longer
          // signals its concurrent siblings. #11 CANCEL links the run-level
          // controller to it: when the run is cancelled (abortController fires)
          // we propagate the abort to this node controller, which (a) aborts
          // the executor's abortSignal and (b) makes withNodeTimeout reject
          // with RunAbortedError so even an abort-ignoring node is interrupted.
          const nodeController = new AbortController();
          const propagateRunAbort = () => {
            try { nodeController.abort(); } catch { /* noop */ }
          };
          if (abortController.signal.aborted) {
            propagateRunAbort();
          } else {
            abortController.signal.addEventListener('abort', propagateRunAbort, { once: true });
            cleanupNodeAbort = () => abortController.signal.removeEventListener('abort', propagateRunAbort);
          }

          const context: ExecutionContext = {
            runId,
            workflowId: workflowId ?? workflow.id,
            workspaceDir: `/tmp/workflow-${runId}`,
            dryRun: options?.dryRun ?? false,
            emit: (event) => emitWorkflowEvent(event),
            getNodeOutput: (id) => nodeOutputs.get(id),
            checkBreakpoint: async () => {},
            abortSignal: nodeController.signal,
            getOutgoingEdges: (id) => graph.edgesBySource.get(id) || [],
            getIncomingEdges: (id) => graph.edgesByTarget.get(id) || [],
            getNodeConfig: (id) => {
              const n = graph.nodeMap.get(id);
              return n ? { type: n.type, config: n.config, label: n.label } : undefined;
            },
            _currentNodeId: nodeId,
            _registry: this.registry,
          };

          // Per-node "On failure" config (set in the canvas inspector). Read
          // before the try block so retry/continue/route modes wrap the
          // executor call uniformly. Default is 'stop' (legacy behaviour).
          const onErrorCfg = (nodeDef.config?._onError as NodeOnErrorConfig | undefined) ?? { mode: 'stop' };
          const onErrorMode = onErrorCfg.mode ?? 'stop';
          const onErrorRetries = Math.max(0, Math.min(10, Number(onErrorCfg.retries ?? 0)));
          const onErrorDelayMs = Math.max(0, Number(onErrorCfg.retryDelayMs ?? 0));

          // Per-node hard timeout: a hung node aborts and surfaces as a
          // node-level failure rather than wedging the run forever. Optional
          // per-instance override via config._timeoutMs (canvas advanced
          // config), otherwise per-type default from engine-runtime.
          const timeoutMs = nodeTimeoutMs(nodeDef.type, nodeDef.config?._timeoutMs);
          console.log(`[engine] node.start run=${runId} node=${nodeId} type=${nodeDef.type} timeout=${Math.round(timeoutMs / 1000)}s`);

          // Engine-level template pre-resolution: {{state.KEY}} / {{today}} /
          // {{now}} are substituted into a per-node config COPY (nodeDef.config
          // is never mutated). {{input.*}} is intentionally left for the
          // executor. Then scan the RESOLVED copy for {{...}} tokens that still
          // won't substitute (missing input field, unknown state key, unknown
          // namespace) and surface them as a non-fatal node_warning + _warnings.
          const { config: resolvedConfig } = resolveStateTemplatesDeep(nodeDef.config, {
            store: storeSnapshot,
            now: new Date(),
          });
          const configWarnings = scanUnknownTemplateVars(resolvedConfig, mergedInput);
          if (configWarnings.length > 0) {
            emit('node_warning', nodeId, { warnings: configWarnings });
          }

          try {
            // Retry wrapper: re-attempt up to `onErrorRetries` times before
            // letting the caught path run. Pause signals propagate immediately
            // and are never retried.
            let result: NodeResult | null = null;
            let attemptErr: unknown = null;
            const maxAttempts = onErrorMode === 'retry' ? onErrorRetries + 1 : 1;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              try {
                result = await withNodeTimeout(nodeId, nodeDef.type, timeoutMs, nodeController, () =>
                  executionContext.run(execCtx, () =>
                    executor.execute(mergedInput, resolvedConfig, context),
                  ),
                );
                attemptErr = null;
                break;
              } catch (err) {
                if (err instanceof PauseForHumanSignal) throw err;
                attemptErr = err;
                if (attempt < maxAttempts && onErrorDelayMs > 0) {
                  await new Promise((r) => setTimeout(r, onErrorDelayMs));
                }
              }
            }
            if (attemptErr) throw attemptErr;
            // Non-null after a successful attempt; assertion narrows the type.
            const r = result as NodeResult;

            // Option A pause sentinel: node executor requests human interaction.
            if (r.pause?.reason === 'awaiting_human') {
              throw new PauseForHumanSignal(nodeId, r.pause.interactionId);
            }

            const rowCount = typeof r.rowCount === 'number' ? r.rowCount : 1;
            // Surface template warnings in the stored output so the inspector
            // shows them, without clobbering an executor-provided _warnings.
            if (configWarnings.length > 0 && r.output && typeof r.output === 'object' && !('_warnings' in r.output)) {
              (r.output as Record<string, unknown>)._warnings = configWarnings;
            }
            nodeOutputs.set(nodeId, r.output);
            const _durationMs = Date.now() - nodeStartedAt;
            console.log(`[engine] node.end run=${runId} node=${nodeId} type=${nodeDef.type} rows=${rowCount} duration=${_durationMs}ms`);
            emit('node_completed', nodeId, { ...r.output, _rowCount: rowCount, _durationMs });

            // Handle conditional routing: if _selectedHandle is set, skip non-matching branches.
            // Edges with no sourceHandle (null/undefined) accept any selectedHandle — this keeps
            // single-output nodes (stealth-scrape, gmail-*, llm-agent) working when canvases
            // store edges without a handle id, and only true branching nodes (conditional,
            // validator, llm-router, error-handler) need explicit per-branch handle tagging.
            const selectedHandle = r.metadata?._selectedHandle as string | undefined;
            if (selectedHandle !== undefined) {
              const outgoingEdges = graph.edgesBySource.get(nodeId) || [];
              for (const edge of outgoingEdges) {
                if (edge.sourceHandle && edge.sourceHandle !== selectedHandle) {
                  blockedEdgeIds.add(edge.id);
                  this.markSkipped(edge.targetNodeId, graph, skippedNodes, blockedEdgeIds);
                }
              }
            }

            finishNodeOk();
            // A data-store / dedupe write may have changed the store — refresh
            // the {{state.*}} snapshot so downstream levels resolve fresh values.
            await refreshStoreSnapshot(nodeDef.type);
          } catch (err: unknown) {
            // Let pause signals propagate immediately — do not heal them.
            if (err instanceof PauseForHumanSignal) throw err;

            // #11 CANCEL: a node aborted by run cancellation must NOT enter
            // self-healing (which would fire a wasteful LLM diagnosis call on a
            // run the user already killed). Record it as a failure and return;
            // the between-levels signal check halts further scheduling.
            if (err instanceof RunAbortedError || abortController.signal.aborted) {
              const abortMsg = err instanceof Error ? err.message : 'Run cancelled';
              nodeErrors.set(nodeId, abortMsg);
              emit('node_failed', nodeId, { error: abortMsg });
              finishNodeFailed(abortMsg);
              return;
            }

            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[engine] node.fail run=${runId} node=${nodeId} type=${nodeDef.type} duration=${Date.now() - nodeStartedAt}ms err=${message.slice(0, 200)}`);

            // User-configured failure handling takes precedence over self-
            // healing. mode='continue' swallows the error and moves on with
            // an empty output. mode='route' marks node failed but routes
            // execution along the node's `error` outgoing edge if one exists.
            if (onErrorMode === 'continue') {
              console.log(`[on-error] ${nodeId} (${nodeDef.type}) failed but mode=continue — swallowing: ${message.slice(0, 100)}`);
              nodeOutputs.set(nodeId, {});
              emit('node_completed', nodeId, { _onErrorContinued: true, _error: message, _durationMs: Date.now() - nodeStartedAt });
              finishNodeOk();
              return;
            }
            if (onErrorMode === 'route') {
              const outgoingEdges = graph.edgesBySource.get(nodeId) || [];
              const hasErrorEdge = outgoingEdges.some((e) => e.sourceHandle === 'error');
              if (hasErrorEdge) {
                console.log(`[on-error] ${nodeId} (${nodeDef.type}) failed, mode=route — selecting 'error' edge`);
                nodeErrors.set(nodeId, message);
                nodeOutputs.set(nodeId, { _error: message });
                emit('node_failed', nodeId, { error: message, _selectedHandle: 'error' });
                for (const edge of outgoingEdges) {
                  if (edge.sourceHandle && edge.sourceHandle !== 'error') {
                    blockedEdgeIds.add(edge.id);
                    this.markSkipped(edge.targetNodeId, graph, skippedNodes, blockedEdgeIds);
                  }
                }
                finishNodeFailed(message);
                return;
              }
              // No error edge declared — fall through to default behaviour.
            }

            // Per-type opt-out: LLM-agent node types (site-mapper, llm-agent)
            // never benefit from the healing loop because their failure mode
            // is "LLM was confused", and healing's response is to ask another
            // LLM call to diagnose — same dysfunction, just slower. List of
            // types that skip healing entirely, regardless of the caller's
            // selfHealing flag.
            const HEALING_EXEMPT_TYPES = new Set(['site-mapper']);
            const selfHealing =
              options?.selfHealing !== false && !HEALING_EXEMPT_TYPES.has(nodeDef.type);
            console.log(`[healing] Node ${nodeId} (${nodeDef.type}) failed: ${message.slice(0, 100)}`);

            if (!selfHealing) {
              nodeErrors.set(nodeId, message);
              emit('node_failed', nodeId, { error: message });
              finishNodeFailed(message);
              throw err;
            }

            // Self-healing loop
            const MAX_HEALING_ATTEMPTS = 3;
            let healed = false;
            let currentError = message;
            let currentConfig = { ...nodeDef.config };
            const attempts: Array<{ diagnosis: string; fixApplied: string; resultError: string }> = [];

            console.log(`[healing] Starting self-healing for ${nodeId} (up to ${MAX_HEALING_ATTEMPTS} attempts)`);
            for (let attempt = 1; attempt <= MAX_HEALING_ATTEMPTS; attempt++) {
              console.log(`[healing] Attempt ${attempt}/${MAX_HEALING_ATTEMPTS} for ${nodeId}`);
              emit('healing_started', nodeId, {
                attempt,
                maxAttempts: MAX_HEALING_ATTEMPTS,
                error: currentError,
                nodeLabel: nodeDef.label,
              });

              try {
                const nodeDef2 = this.registry.getDefinition(nodeDef.type);
                const healingContext: HealingContext = {
                  error: currentError,
                  nodeType: nodeDef.type,
                  nodeLabel: nodeDef.label,
                  nodeConfig: currentConfig,
                  inputData: mergedInput,
                  nodeDefinition: nodeDef2 || {
                    type: nodeDef.type,
                    label: nodeDef.label,
                    category: 'core' as const,
                    description: '',
                    configSchema: { type: 'object' },
                    defaultConfig: {},
                    inputs: [{ name: 'input', type: 'any' as const }],
                    outputs: [{ name: 'output', type: 'any' as const }],
                  },
                  previousAttempts: attempts,
                  workflowContext: {
                    nodes: workflow.nodes.map(n => ({ id: n.id, type: n.type, label: n.label })),
                    edges: workflow.edges.map(e => ({ sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId })),
                    upstreamOutputs: Object.fromEntries(
                      Array.from(nodeOutputs.entries()).filter(([id]) => {
                        const incoming = graph.edgesByTarget.get(nodeId) || [];
                        return incoming.some(e => e.sourceNodeId === id);
                      }),
                    ),
                  },
                };

                console.log(`[healing] Calling LLM diagnosis for ${nodeId}...`);
                // Timeout the diagnosis call after 60s
                const diagnosisPromise = diagnoseAndFix(
                  healingContext,
                  (text) => emit('healing_progress', nodeId, { text }),
                );
                const timeoutPromise = new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('Diagnosis timed out after 60s')), 60000),
                );
                const diagnosis = await Promise.race([diagnosisPromise, timeoutPromise]);
                console.log(`[healing] Diagnosis for ${nodeId}: ${diagnosis.category} — ${diagnosis.diagnosis.slice(0, 100)}`);

                if (diagnosis.category === 'environment_issue') {
                  emit('healing_blocked', nodeId, {
                    diagnosis: diagnosis.diagnosis,
                    reasoning: diagnosis.reasoning,
                    environmentAction: diagnosis.environmentAction,
                    alternative: diagnosis.alternative,
                  });
                  nodeErrors.set(nodeId, `Environment issue: ${diagnosis.diagnosis}`);
                  const outgoingEdges = graph.edgesBySource.get(nodeId) || [];
                  for (const edge of outgoingEdges) {
                    blockedEdgeIds.add(edge.id);
                    this.markSkipped(edge.targetNodeId, graph, skippedNodes, blockedEdgeIds);
                  }
                  break;
                }

                if (diagnosis.category === 'unknown' || !diagnosis.fix) {
                  emit('healing_progress', nodeId, { text: `Could not determine a fix: ${diagnosis.diagnosis}` });
                  attempts.push({
                    diagnosis: diagnosis.diagnosis,
                    fixApplied: 'none',
                    resultError: currentError,
                  });
                  continue;
                }

                if (diagnosis.fix.type === 'update_config') {
                  const originalConfig = { ...currentConfig };
                  const newConfig = { ...currentConfig, ...diagnosis.fix.changes };

                  const undoEntry: UndoEntry = {
                    id: crypto.randomUUID(),
                    runId,
                    nodeId,
                    attempt,
                    timestamp: new Date().toISOString(),
                    originalConfig,
                    newConfig,
                    fixDescription: diagnosis.fix.description,
                  };
                  healingHistory.push(undoEntry);

                  // Apply the healed config to the per-run local copy only.
                  // Do NOT mutate nodeDef.config — that object is the persistent
                  // node definition (shared via graph.nodeMap) and gets written
                  // back to workflow_nodes by the persister, which would silently
                  // rewrite the user's saved workflow. The retry below executes
                  // with `currentConfig`, so the heal is scoped to this run.
                  currentConfig = newConfig;

                  emit('healing_fix_applied', nodeId, {
                    fixType: 'config',
                    description: diagnosis.fix.description,
                    undoId: undoEntry.id,
                    attempt,
                  });
                }

                // Retry the node
                const retryStartedAt = Date.now();
                emit('node_started', nodeId);
                try {
                  // Re-apply engine template resolution to the healed config.
                  const { config: resolvedRetryConfig } = resolveStateTemplatesDeep(currentConfig, {
                    store: storeSnapshot,
                    now: new Date(),
                  });
                  const retryResult: NodeResult = await withNodeTimeout(
                    nodeId, nodeDef.type, timeoutMs, nodeController,
                    () => executionContext.run(execCtx, () =>
                      executor.execute(mergedInput, resolvedRetryConfig, context),
                    ),
                  );
                  const retryRowCount = typeof retryResult.rowCount === 'number' ? retryResult.rowCount : 1;
                  nodeOutputs.set(nodeId, retryResult.output);
                  emit('healing_succeeded', nodeId, { attempt });
                  emit('node_completed', nodeId, { ...retryResult.output, _rowCount: retryRowCount, _durationMs: Date.now() - retryStartedAt });

                  const retryHandle = retryResult.metadata?._selectedHandle as string | undefined;
                  if (retryHandle !== undefined) {
                    const outEdges = graph.edgesBySource.get(nodeId) || [];
                    for (const edge of outEdges) {
                      if (edge.sourceHandle && edge.sourceHandle !== retryHandle) {
                        blockedEdgeIds.add(edge.id);
                        this.markSkipped(edge.targetNodeId, graph, skippedNodes, blockedEdgeIds);
                      }
                    }
                  }

                  healed = true;
                  finishNodeOk();
                  await refreshStoreSnapshot(nodeDef.type);
                  break;
                } catch (retryErr: unknown) {
                  currentError = retryErr instanceof Error ? retryErr.message : String(retryErr);
                  attempts.push({
                    diagnosis: diagnosis.diagnosis,
                    fixApplied: diagnosis.fix.description,
                    resultError: currentError,
                  });
                  emit('healing_progress', nodeId, { text: `Fix attempt ${attempt} failed: ${currentError}` });
                }
              } catch (healErr: unknown) {
                const healMsg = healErr instanceof Error ? healErr.message : String(healErr);
                console.error(`[healing] Error for ${nodeId}: ${healMsg}`);
                emit('healing_progress', nodeId, { text: `Healing error: ${healMsg}` });
                break;
              }
            }

            if (!healed) {
              emit('healing_failed', nodeId, { attempts });
              nodeErrors.set(nodeId, currentError);
              const outgoingEdges = graph.edgesBySource.get(nodeId) || [];
              for (const edge of outgoingEdges) {
                blockedEdgeIds.add(edge.id);
                this.markSkipped(edge.targetNodeId, graph, skippedNodes, blockedEdgeIds);
              }
              finishNodeFailed(currentError);
              // Don't throw — let other branches continue
            }

            // Safety-net drain for any exit path not covered above. drain()
            // and the finishNode* helpers are idempotent — re-running here
            // is harmless and protects against a future code change that
            // adds a new exit without remembering to emit observability.
            drain();
          }
        });

        await Promise.all(promises);
      }

      // Determine final status
      const hasErrors = nodeErrors.size > 0;
      const hasCompletedNodes = nodeOutputs.size > 0;
      const finalStatus: RunStatus = hasErrors
        ? (hasCompletedNodes ? 'completed_with_errors' : 'failed')
        : 'completed';

      if (finalStatus === 'completed') {
        emit('run_completed');
        // Commit any deferred dedupe records (recordMode: 'downstream-success')
        // now that the run has finished cleanly — items were only marked seen
        // once every downstream node (e.g. the send) actually succeeded. The
        // records are read from the dedupe nodes' OUTPUTS (persisted + resume-
        // seeded), so they survive an awaiting_human pause that resumes in a
        // different process — a module-global map used to lose them there,
        // silently re-sending the same items on the next run.
        const dedupeOutputs: Array<Record<string, unknown> | undefined> = [];
        for (const [nid, out] of nodeOutputs) {
          if (graph.nodeMap.get(nid)?.type === 'dedupe') dedupeOutputs.push(out);
        }
        await commitDeferredDedupeRecords(dedupeOutputs);
      } else if (finalStatus === 'completed_with_errors') {
        emit('run_completed_with_errors');
        // Some node failed — do NOT commit deferred dedupe ids (a failed send
        // must not mark its items as seen); they retry next run. Deferred records
        // live only in the node outputs, which are simply left uncommitted.
      } else {
        emit('run_failed');
      }

      // D1: fire-and-forget run-outcome notification (engine-level so worker-mode
      // runs alert too). Silent unless the workflow opted in; never throws.
      // Merge terminal-node outputs (nodes with no outgoing edges) so a
      // completion digest can pull `digestField` from the run's final results.
      const terminalOutputs: Record<string, unknown> = {};
      for (const nodeId of graph.nodeIds) {
        const outs = graph.edgesBySource.get(nodeId);
        if (!outs || outs.length === 0) {
          const o = nodeOutputs.get(nodeId);
          if (o && typeof o === 'object') Object.assign(terminalOutputs, o);
        }
      }
      void notifyRunOutcome({
        workflowId: effectiveWorkflowId,
        workflowName: workflow.name,
        runId,
        status: finalStatus,
        error: nodeErrors.size > 0 ? Array.from(nodeErrors.values()).join('; ') : undefined,
        terminalOutputs,
      }).catch((e) =>
        console.error('[engine] notifyRunOutcome failed:', e instanceof Error ? e.message : e),
      );

      cleanupRunEmitter(runId);
      this.activeBreakpoints.delete(runId);
      stopHeartbeat();
      releaseSlot();
      return { status: finalStatus, nodeOutputs, nodeInputs, nodeErrors, nodeUsage, nodeStartTimes, healingHistory };
    } catch (err: unknown) {
      // Human-in-the-loop pause: the run halts cleanly (no failure).
      if (err instanceof PauseForHumanSignal) {
        emit('node_paused', err.nodeId, { interactionId: err.interactionId });
        cleanupRunEmitter(runId);
        this.activeBreakpoints.delete(runId);
        stopHeartbeat();
        releaseSlot();
        return {
          status: 'awaiting_human',
          nodeOutputs,
          nodeInputs,
          nodeErrors,
          nodeUsage,
          nodeStartTimes,
          healingHistory,
          pausedAtNodeId: err.nodeId,
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      emit('run_failed', undefined, { error: message });
      // Deferred dedupe records (recordMode: 'downstream-success') live only in
      // the node outputs and are simply left uncommitted on failure.
      // D1: fire-and-forget failure notification for the thrown-error path too.
      // No terminalOutputs here (graph is unavailable in this scope) — a failed
      // run never sends a completion digest anyway. Never throws.
      void notifyRunOutcome({
        workflowId: workflowId ?? workflow.id,
        workflowName: workflow.name,
        runId,
        status: 'failed',
        error: message,
      }).catch((e) =>
        console.error('[engine] notifyRunOutcome failed:', e instanceof Error ? e.message : e),
      );
      cleanupRunEmitter(runId);
      this.activeBreakpoints.delete(runId);
      stopHeartbeat();
      releaseSlot();
      return { status: 'failed', nodeOutputs, nodeInputs, nodeErrors, nodeUsage, nodeStartTimes, error: message, healingHistory };
    }
  }
}
