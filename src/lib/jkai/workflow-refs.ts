/**
 * Canvas deep-link chips on a chat reply — `metadata.workflowRefs`, which
 * ChatArea renders under an assistant turn.
 *
 * These came from the Hermes branch of the chat endpoint and died with it
 * (#489): nothing produced them after 2026-08-27, so a turn that built or
 * edited a workflow answered with prose and no way onto the canvas. Now derived
 * from the turn's tool steps, the same record `toolSteps`/`traceId` come from.
 */
export interface WorkflowChipRef {
  workflowId: string;
  slug: string;
  name: string;
  url: string;
}

/** A ref before its slug is known — edit tools return only a workflowId. */
export interface PendingWorkflowRef {
  workflowId: string;
  slug: string | null;
  name: string | null;
}

/**
 * Tools that create or CHANGE a canvas. Reads (inspect, list, get_run, lint)
 * are left out: a chip says "this turn touched that canvas".
 */
const CANVAS_WRITING_TOOLS = new Set([
  'workflow_generate',
  'workflow_build_from_spec',
  'workflow_create',
  'monitor_create',
  'workflow_amend',
  'workflow_add_node',
  'workflow_update_node',
  'workflow_remove_node',
  'workflow_add_edge',
  'workflow_remove_edge',
  'workflow_update_edge',
  'workflow_update_metadata',
  'workflow_add_schedule',
  'workflow_update_schedule',
  'workflow_remove_schedule',
]);

export const MAX_WORKFLOW_REFS = 6;

const CANVAS_URL = /\/jkai\/canvas\/([a-z0-9][a-z0-9-]*)/i;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

interface StepLike {
  tool: string;
  status?: string;
  args?: unknown;
  result?: unknown;
}

/**
 * Canvases the turn's tool calls wrote to, first-touched first, deduped by
 * workflow. A generate that saved a graph needing fixes still returns its
 * `data` (with `success: false`) — that canvas exists and is exactly where the
 * owner needs to go, so a step counts whenever its result names a workflow.
 */
export function collectWorkflowRefs(steps: StepLike[]): PendingWorkflowRef[] {
  const out: PendingWorkflowRef[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    if (!CANVAS_WRITING_TOOLS.has(step.tool)) continue;
    const result = (step.result ?? {}) as { success?: boolean; data?: unknown };
    const raw = (result.data && typeof result.data === 'object' ? result.data : {}) as Record<string, unknown>;
    // monitor_create nests its marker under `monitor`; the builders are flat.
    const data = (raw.workflowId ? raw : (raw.monitor ?? raw)) as Record<string, unknown>;
    const args = (step.args && typeof step.args === 'object' ? step.args : {}) as Record<string, unknown>;
    const workflowId = str(data.workflowId) ?? (result.success ? str(args.workflowId) : null);
    if (!workflowId || seen.has(workflowId)) continue;
    seen.add(workflowId);
    const fromUrl = str(data.url)?.match(CANVAS_URL)?.[1] ?? null;
    out.push({
      workflowId,
      slug: str(data.slug) ?? fromUrl,
      name: str(data.name) ?? str(data.description)?.slice(0, 60) ?? null,
    });
    if (out.length >= MAX_WORKFLOW_REFS) break;
  }
  return out;
}

/** Fill in what an edit tool's result did not carry, from the canvas rows. */
export function finishWorkflowRefs(
  pending: PendingWorkflowRef[],
  rows: Array<{ id: string; name: string; description: string | null }>,
): WorkflowChipRef[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: WorkflowChipRef[] = [];
  for (const p of pending) {
    const row = byId.get(p.workflowId);
    const slug = row?.name.startsWith('canvas:') ? row.name.slice('canvas:'.length) : p.slug;
    // Not a canvas (a legacy non-canvas workflow) or deleted since: no page to link.
    if (!slug || (row && !row.name.startsWith('canvas:')) || (!row && !p.slug)) continue;
    out.push({
      workflowId: p.workflowId,
      slug,
      name: p.name ?? row?.description?.trim() ?? slug,
      url: `/jkai/canvas/${slug}`,
    });
  }
  return out;
}
