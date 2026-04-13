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

export interface EngineResult {
  status: RunStatus;
  nodeOutputs: Map<string, Record<string, unknown>>;
  nodeInputs: Map<string, Record<string, unknown>>;
  nodeErrors: Map<string, string>;
  error?: string;
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

  async execute(
    workflow: WorkflowDefinition,
    runId: string,
    initialInput: Record<string, unknown>,
    breakpoints?: Set<string>,
    workflowId?: string,
  ): Promise<EngineResult> {
    const nodeOutputs = new Map<string, Record<string, unknown>>();
    const nodeInputs = new Map<string, Record<string, unknown>>();
    const nodeErrors = new Map<string, string>();
    const skippedNodes = new Set<string>();
    const blockedEdgeIds = new Set<string>();
    const abortController = new AbortController();

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

          emit('node_started', nodeId);

          const context: ExecutionContext = {
            runId,
            workflowId: workflowId ?? workflow.id,
            workspaceDir: `/tmp/workflow-${runId}`,
            emit: (event) => emitWorkflowEvent(event),
            getNodeOutput: (id) => nodeOutputs.get(id),
            checkBreakpoint: async () => {},
            abortSignal: abortController.signal,
          };

          try {
            const result: NodeResult = await executor.execute(mergedInput, nodeDef.config, context);
            nodeOutputs.set(nodeId, result.output);
            emit('node_completed', nodeId, result.output);

            // Handle conditional routing: if _selectedHandle is set, skip non-matching branches
            const selectedHandle = result.metadata?._selectedHandle as string | undefined;
            if (selectedHandle !== undefined) {
              const outgoingEdges = graph.edgesBySource.get(nodeId) || [];
              for (const edge of outgoingEdges) {
                if (edge.sourceHandle !== selectedHandle) {
                  blockedEdgeIds.add(edge.id);
                  this.markSkipped(edge.targetNodeId, graph, skippedNodes, blockedEdgeIds);
                }
              }
            }
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            nodeErrors.set(nodeId, message);
            emit('node_failed', nodeId, { error: message });
            throw err;
          }
        });

        await Promise.all(promises);
      }

      emit('run_completed');
      cleanupRunEmitter(runId);
      this.activeBreakpoints.delete(runId);
      return { status: 'completed', nodeOutputs, nodeInputs, nodeErrors };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      emit('run_failed', undefined, { error: message });
      cleanupRunEmitter(runId);
      this.activeBreakpoints.delete(runId);
      return { status: 'failed', nodeOutputs, nodeInputs, nodeErrors, error: message };
    }
  }
}
