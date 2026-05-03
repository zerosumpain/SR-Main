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
import type { HealingContext, UndoEntry, NodeDefinition } from './types';
import {
  acquireRunSlot,
  nodeTimeoutMs,
  startHeartbeat,
  withNodeTimeout,
} from './engine-runtime';

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
  error?: string;
  healingHistory?: UndoEntry[];
  /** Populated when the engine paused mid-run for human interaction. */
  pausedAtNodeId?: string;
}

export class WorkflowEngine {
  private breakpointResolvers = new Map<string, (modifiedInput?: Record<string, unknown>) => void>();
  private activeBreakpoints = new Map<string, Set<string>>();

  constructor(private registry: NodeRegistry) {}

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

  async execute(
    workflow: WorkflowDefinition,
    runId: string,
    initialInput: Record<string, unknown>,
    breakpoints?: Set<string>,
    workflowId?: string,
    options?: { selfHealing?: boolean; dryRun?: boolean },
    preSeededOutputs?: Record<string, Record<string, unknown>>,
  ): Promise<EngineResult> {
    const nodeOutputs = new Map<string, Record<string, unknown>>();
    const nodeInputs = new Map<string, Record<string, unknown>>();
    const nodeErrors = new Map<string, string>();
    const skippedNodes = new Set<string>();
    const blockedEdgeIds = new Set<string>();

    // Pre-seed node outputs for already-completed nodes (resume path).
    if (preSeededOutputs) {
      for (const [id, output] of Object.entries(preSeededOutputs)) {
        nodeOutputs.set(id, output);
      }
    }
    const abortController = new AbortController();
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

      for (const level of levels) {
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

          // Gather input from upstream nodes (only non-skipped sources)
          const incomingEdges = graph.edgesByTarget.get(nodeId) || [];
          let mergedInput: Record<string, unknown>;

          if (incomingEdges.length === 0) {
            mergedInput = { ...initialInput };
          } else {
            mergedInput = {};
            for (const edge of incomingEdges) {
              if (skippedNodes.has(edge.sourceNodeId)) continue;
              const upstream = nodeOutputs.get(edge.sourceNodeId);
              if (upstream) {
                Object.assign(mergedInput, upstream);
              }
            }
          }

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
          emit('node_started', nodeId);

          const context: ExecutionContext = {
            runId,
            workflowId: workflowId ?? workflow.id,
            workspaceDir: `/tmp/workflow-${runId}`,
            dryRun: options?.dryRun ?? false,
            emit: (event) => emitWorkflowEvent(event),
            getNodeOutput: (id) => nodeOutputs.get(id),
            checkBreakpoint: async () => {},
            abortSignal: abortController.signal,
            getOutgoingEdges: (id) => graph.edgesBySource.get(id) || [],
            getNodeConfig: (id) => {
              const n = graph.nodeMap.get(id);
              return n ? { type: n.type, config: n.config, label: n.label } : undefined;
            },
            _currentNodeId: nodeId,
            _registry: this.registry,
          } as ExecutionContext & { _currentNodeId: string; _registry: NodeRegistry };

          // Per-node "On failure" config (set in the canvas inspector). Read
          // before the try block so retry/continue/route modes wrap the
          // executor call uniformly. Default is 'stop' (legacy behaviour).
          const onErrorCfg = (nodeDef.config?._onError as
            | { mode?: 'stop' | 'continue' | 'retry' | 'route'; retries?: number; retryDelayMs?: number }
            | undefined) ?? { mode: 'stop' };
          const onErrorMode = onErrorCfg.mode ?? 'stop';
          const onErrorRetries = Math.max(0, Math.min(10, Number(onErrorCfg.retries ?? 0)));
          const onErrorDelayMs = Math.max(0, Number(onErrorCfg.retryDelayMs ?? 0));

          // Per-node hard timeout: a hung node aborts and surfaces as a
          // node-level failure rather than wedging the run forever. Optional
          // per-instance override via config._timeoutMs (canvas advanced
          // config), otherwise per-type default from engine-runtime.
          const timeoutMs = nodeTimeoutMs(nodeDef.type, nodeDef.config?._timeoutMs);
          console.log(`[engine] node.start run=${runId} node=${nodeId} type=${nodeDef.type} timeout=${Math.round(timeoutMs / 1000)}s`);

          try {
            // Retry wrapper: re-attempt up to `onErrorRetries` times before
            // letting the caught path run. Pause signals propagate immediately
            // and are never retried.
            let result: NodeResult | null = null;
            let attemptErr: unknown = null;
            const maxAttempts = onErrorMode === 'retry' ? onErrorRetries + 1 : 1;
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              try {
                result = await withNodeTimeout(nodeId, nodeDef.type, timeoutMs, abortController, () =>
                  executor.execute(mergedInput, nodeDef.config, context),
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
          } catch (err: unknown) {
            // Let pause signals propagate immediately — do not heal them.
            if (err instanceof PauseForHumanSignal) throw err;

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

                  currentConfig = newConfig;
                  nodeDef.config = newConfig;

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
                  const retryResult: NodeResult = await withNodeTimeout(
                    nodeId, nodeDef.type, timeoutMs, abortController,
                    () => executor.execute(mergedInput, currentConfig, context),
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
              // Don't throw — let other branches continue
            }
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
      } else if (finalStatus === 'completed_with_errors') {
        emit('run_completed_with_errors');
      } else {
        emit('run_failed');
      }
      cleanupRunEmitter(runId);
      this.activeBreakpoints.delete(runId);
      stopHeartbeat();
      releaseSlot();
      return { status: finalStatus, nodeOutputs, nodeInputs, nodeErrors, healingHistory };
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
          healingHistory,
          pausedAtNodeId: err.nodeId,
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      emit('run_failed', undefined, { error: message });
      cleanupRunEmitter(runId);
      this.activeBreakpoints.delete(runId);
      stopHeartbeat();
      releaseSlot();
      return { status: 'failed', nodeOutputs, nodeInputs, nodeErrors, error: message, healingHistory };
    }
  }
}
