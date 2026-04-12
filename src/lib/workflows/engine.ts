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
import { emitWorkflowEvent, onWorkflowEvent, cleanupRunEmitter } from './events';

export interface EngineResult {
  status: RunStatus;
  nodeOutputs: Map<string, Record<string, unknown>>;
  nodeErrors: Map<string, string>;
  error?: string;
}

export class WorkflowEngine {
  constructor(private registry: NodeRegistry) {}

  onEvent(runId: string, handler: (event: WorkflowEvent) => void): () => void {
    return onWorkflowEvent(runId, handler);
  }

  async execute(
    workflow: WorkflowDefinition,
    runId: string,
    initialInput: Record<string, unknown>,
    breakpoints?: Set<string>,
  ): Promise<EngineResult> {
    const nodeOutputs = new Map<string, Record<string, unknown>>();
    const nodeErrors = new Map<string, string>();
    const abortController = new AbortController();

    const breakpointResolvers = new Map<string, () => void>();

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
          const nodeDef = graph.nodeMap.get(nodeId)!;
          const executor = this.registry.getExecutor(nodeDef.type);

          if (!executor) {
            throw new Error(`No executor found for node type: ${nodeDef.type}`);
          }

          // Gather input from upstream nodes
          const incomingEdges = graph.edgesByTarget.get(nodeId) || [];
          let mergedInput: Record<string, unknown>;

          if (incomingEdges.length === 0) {
            mergedInput = { ...initialInput };
          } else {
            mergedInput = {};
            for (const edge of incomingEdges) {
              const upstream = nodeOutputs.get(edge.sourceNodeId);
              if (upstream) {
                Object.assign(mergedInput, upstream);
              }
            }
          }

          // Check breakpoint
          if (breakpoints?.has(nodeId)) {
            emit('breakpoint_hit', nodeId, mergedInput);
            emit('node_paused', nodeId);
            await new Promise<void>((resolve) => {
              breakpointResolvers.set(nodeId, resolve);
            });
          }

          emit('node_started', nodeId);

          const context: ExecutionContext = {
            runId,
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
      return { status: 'completed', nodeOutputs, nodeErrors };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      emit('run_failed', undefined, { error: message });
      cleanupRunEmitter(runId);
      return { status: 'failed', nodeOutputs, nodeErrors, error: message };
    }
  }
}
