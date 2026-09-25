import type { NodeExecutor } from './types';

/**
 * What a resumed run is seeded with: every output the engine already has, and
 * every branch choice made before the pause.
 *
 * Kept free of the DB and the engine so the rule is testable on its own —
 * engine-resume reads the rows, this decides what they mean.
 */
export interface ResumeSeed {
  /** nodeId → output, for every node the walker must NOT run again. */
  outputs: Record<string, Record<string, unknown>>;
  /** nodeId → the handle that node selected, so routing is replayed. */
  handles: Record<string, string>;
}

export interface ResumeExecutionRow {
  nodeId: string;
  status: string;
  outputData: unknown;
  selectedHandle?: string | null;
}

export function buildResumeSeed(opts: {
  executions: ResumeExecutionRow[];
  pausedNodeId: string;
  /** The input the paused node received before it paused. */
  pausedNodeInput: Record<string, unknown>;
  /** What the human's resolution produced (form values etc). */
  resolved: Record<string, unknown>;
  /** The paused node's executor, when it knows how to turn a resolution into output. */
  executor?: Pick<NodeExecutor, 'resumeResult'> | null;
}): ResumeSeed {
  const { executions, pausedNodeId, pausedNodeInput, resolved, executor } = opts;
  const outputs: Record<string, Record<string, unknown>> = {};
  const handles: Record<string, string> = {};

  for (const exec of executions) {
    if (exec.nodeId === pausedNodeId) continue;
    if (exec.status !== 'completed' || !exec.outputData) continue;
    outputs[exec.nodeId] = exec.outputData as Record<string, unknown>;
    if (exec.selectedHandle) handles[exec.nodeId] = exec.selectedHandle;
  }

  if (executor?.resumeResult) {
    const r = executor.resumeResult(resolved, pausedNodeInput);
    outputs[pausedNodeId] = r.output;
    if (r.selectedHandle) handles[pausedNodeId] = r.selectedHandle;
  } else {
    outputs[pausedNodeId] = resolved;
  }

  return { outputs, handles };
}
