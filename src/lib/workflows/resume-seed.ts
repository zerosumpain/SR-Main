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

export type RecoveryPlan =
  | { ok: true; seed: ResumeSeed; rerun: string[] }
  | { ok: false; reason: string; interrupted: string[] };

/**
 * What crash recovery may do with a run's node rows. Completed steps are
 * seeded (with their branch choices); a step that was `running` when the
 * process died is re-run only if idempotent — otherwise its side effect is
 * unknown and the run must not continue. A step that had already failed ends
 * recovery too: the run's outcome was already decided.
 */
export function planRecovery(executions: ResumeExecutionRow[], isIdempotent: (nodeId: string) => boolean): RecoveryPlan {
  const seed: ResumeSeed = { outputs: {}, handles: {} };
  const rerun: string[] = [];
  const interrupted: string[] = [];
  for (const exec of executions) {
    if (exec.status === 'completed' && exec.outputData) {
      seed.outputs[exec.nodeId] = exec.outputData as Record<string, unknown>;
      if (exec.selectedHandle) seed.handles[exec.nodeId] = exec.selectedHandle;
    } else if (exec.status === 'failed') {
      return { ok: false, reason: `step ${exec.nodeId} had already failed`, interrupted: [] };
    } else if (exec.status === 'running') {
      (isIdempotent(exec.nodeId) ? rerun : interrupted).push(exec.nodeId);
    }
  }
  if (interrupted.length > 0) {
    return { ok: false, reason: `interrupted mid-step (${interrupted.join(', ')}); not re-run because it may have taken effect`, interrupted };
  }
  return { ok: true, seed, rerun };
}
