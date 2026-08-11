/**
 * A minimal ExecutionContext for running a node executor outside a workflow run.
 *
 * Some capabilities only exist as workflow nodes, and chat needs to reach them
 * without a canvas, a run row or a graph around them. The precedent is
 * `/api/scraper/node`, which has built a context like this by hand since the
 * stealth-scrape split so homeserv could run one node on the VPS's behalf.
 *
 * The graph accessors return empty rather than throwing: a standalone call has
 * no neighbours by definition, and an executor that asks for them is telling
 * you it cannot run this way. `emit` buffers instead of publishing, so a
 * caller can surface progress if it wants it and drop it if it does not.
 */
import type { ExecutionContext, WorkflowEvent } from './types';

export interface StandaloneContext extends ExecutionContext {
  /** Events the executor emitted during the call, in order. */
  events: WorkflowEvent[];
}

export function standaloneContext(
  options: { runId?: string; nodeId?: string; dryRun?: boolean; abortSignal?: AbortSignal } = {},
): StandaloneContext {
  const runId = options.runId ?? `standalone-${crypto.randomUUID()}`;
  const events: WorkflowEvent[] = [];
  return {
    events,
    runId,
    workflowId: runId,
    workspaceDir: `/tmp/workflow-${runId}`,
    dryRun: options.dryRun ?? false,
    emit: (event) => {
      events.push(event);
    },
    getNodeOutput: () => undefined,
    getNodeError: () => undefined,
    checkBreakpoint: async () => {},
    abortSignal: options.abortSignal ?? new AbortController().signal,
    getOutgoingEdges: () => [],
    getIncomingEdges: () => [],
    getNodeConfig: () => undefined,
    _currentNodeId: options.nodeId ?? 'standalone',
  };
}
