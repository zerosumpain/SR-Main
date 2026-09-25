import { listRuns, loadRunDetail } from '$lib/workflows/native/workflows.server';
import { readBuildState, type BuildState } from '$lib/workflows/build-state.server';

/**
 * What the canvas editor's needs-attention banner shows: the latest run, when
 * it failed or finished with errors, with the FIRST step that failed and its
 * error. Built from the same run readers the iPhone's run detail uses, so the
 * phone and the web name the same step.
 */
export interface CanvasAttention {
  runId: string;
  status: 'failed' | 'completed_with_errors';
  startedAt: string | null;
  /** Null when the run failed before any step did (a bad trigger, a timeout). */
  nodeId: string | null;
  nodeLabel: string | null;
  error: string | null;
}

const ATTENTION_STATUSES = new Set(['failed', 'completed_with_errors']);

export async function loadCanvasAttention(workflowId: string): Promise<CanvasAttention | null> {
  const [latest] = await listRuns(workflowId, 1);
  if (!latest || !ATTENTION_STATUSES.has(latest.status)) return null;
  const detail = await loadRunDetail(latest.id);
  const failed = detail?.steps.find((s) => s.status === 'failed' && s.error) ?? detail?.steps.find((s) => s.status === 'failed');
  return {
    runId: latest.id,
    status: latest.status as CanvasAttention['status'],
    startedAt: latest.startedAt,
    nodeId: failed?.nodeId ?? null,
    nodeLabel: failed?.label ?? null,
    error: failed?.error ?? latest.error ?? null,
  };
}

/** Both reads for the editor's load, neither allowed to take the page down. */
export async function loadCanvasJourneyState(
  workflowId: string,
): Promise<{ build: BuildState; attention: CanvasAttention | null }> {
  const [build, attention] = await Promise.all([
    readBuildState(workflowId).catch(() => ({ building: false, buildError: null })),
    loadCanvasAttention(workflowId).catch(() => null),
  ]);
  return { build, attention };
}
