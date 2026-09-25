import { and, asc, desc, eq, inArray, like, sql } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/db';
import {
  nodeExecutions,
  workflowEdges,
  workflowNodes,
  workflowRuns,
  workflowSchedules,
  workflows,
  type Workflow,
} from '$lib/db/schema';
import { getDefinition } from '$lib/workflows/registry-client';
import { summarizeNode } from '$lib/workflows/node-summary';
import { cronTimezone } from '$lib/workflows/cron-timezone';
import { readBuildState, readBuildStates, NO_BUILD } from '$lib/workflows/build-state.server';
import type { WorkflowVerification } from '$lib/workflows/test-runs.server';
import {
  attentionFor,
  deriveFormFields,
  graphVersion,
  isStepNode,
  orderSteps,
  outputPreview,
  outputRows,
  runSummary,
  sortWorkflowCards,
  triggerDTO,
  type FieldDTO,
  type GraphEdge,
  type GraphNode,
  type RunSummaryDTO,
  type TriggerDTO,
} from './dto';
import { categoryOfType } from './catalogue';
import {
  countPendingFixProposals,
  listFixProposals,
  toFixProposalDTO,
  type FixProposalDTO,
} from '$lib/workflows/fix-proposals.server';

/**
 * The reads behind `/api/native/workflows`. Rows in, contract out — every
 * decision is delegated to the pure functions in `./dto`.
 *
 * Only CANVAS workflows (`canvas:<slug>`) are listed or addressable: the slug
 * is the phone's handle, and the canvas index filters on the same prefix, so
 * the phone and `/jkai/canvas` see the same set.
 */

export const CANVAS_PREFIX = 'canvas:';

export function canvasName(slug: string): string {
  return `${CANVAS_PREFIX}${slug}`;
}

export function slugOf(name: string): string {
  return name.startsWith(CANVAS_PREFIX) ? name.slice(CANVAS_PREFIX.length) : name;
}

/**
 * The title a canvas shows. `workflows.description` is what the canvas uses as
 * its title (`createCanvas` writes the title there) — it has never held prose
 * separate from the title, which is why the contract's `description` is null.
 */
export function titleOf(row: Pick<Workflow, 'name' | 'description'>): string {
  return row.description?.trim() || slugOf(row.name);
}

export async function findCanvas(slug: string): Promise<Workflow | null> {
  if (!slug) return null;
  const [row] = await db.select().from(workflows).where(eq(workflows.name, canvasName(slug))).limit(1);
  return row ?? null;
}

export async function loadGraph(
  workflowId: string,
  conn: DbExecutor = db,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const [nodes, edges] = await Promise.all([
    conn
      .select({
        id: workflowNodes.id,
        type: workflowNodes.type,
        label: workflowNodes.label,
        config: workflowNodes.config,
        position: workflowNodes.position,
        version: workflowNodes.version,
      })
      .from(workflowNodes)
      .where(eq(workflowNodes.workflowId, workflowId)),
    conn
      .select({
        id: workflowEdges.id,
        sourceNodeId: workflowEdges.sourceNodeId,
        targetNodeId: workflowEdges.targetNodeId,
        sourceHandle: workflowEdges.sourceHandle,
      })
      .from(workflowEdges)
      .where(eq(workflowEdges.workflowId, workflowId)),
  ]);
  return {
    nodes: nodes.map((n) => ({ ...n, config: (n.config ?? {}) as Record<string, unknown> })),
    edges,
  };
}

/**
 * The graph version as stored right now — what `/amend` checks
 * `expectedVersion` against. Pass the amend's transaction handle so the check
 * and the writes see the same graph.
 */
export async function currentGraphVersion(workflowId: string, conn: DbExecutor = db): Promise<number> {
  const { nodes, edges } = await loadGraph(workflowId, conn);
  return graphVersion(nodes, edges);
}

function triggerFor(
  row: Pick<Workflow, 'trigger'>,
  nodes: GraphNode[],
  edges: GraphEdge[],
  schedules: Array<{ type: string; config: unknown; enabled: boolean }>,
): TriggerDTO {
  const triggerNode = nodes.find((n) => n.type === 'trigger');
  const chatIds = new Set(nodes.filter((n) => n.type === 'chat').map((n) => n.id));
  return triggerDTO({
    row: (row.trigger as Record<string, unknown> | null) ?? null,
    triggerNodeConfig: triggerNode?.config ?? null,
    schedules,
    nodeTypes: nodes.map((n) => n.type),
    chatWired: edges.some((e) => chatIds.has(e.sourceNodeId)),
    resolveZone: cronTimezone,
  });
}

// ———————————————————————————————————————————— list

export interface WorkflowCardDTO {
  slug: string;
  title: string;
  description: string | null;
  trigger: TriggerDTO;
  nodeCount: number;
  lastRun: RunSummaryDTO | null;
  needsAttention: boolean;
  attentionReason: string | null;
  updatedAt: string;
}

export async function listWorkflowCards(): Promise<WorkflowCardDTO[]> {
  const rows = await db
    .select()
    .from(workflows)
    .where(like(workflows.name, `${CANVAS_PREFIX}%`))
    .orderBy(desc(workflows.updatedAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  // Grouped reads — one query per table, not per canvas (the loop listCanvases
  // replaced was 1 + 3N queries and slowed with every canvas added).
  const [nodes, edges, schedules, lastRuns, builds, pendingFixes] = await Promise.all([
    db
      .select({
        workflowId: workflowNodes.workflowId,
        id: workflowNodes.id,
        type: workflowNodes.type,
        label: workflowNodes.label,
        config: workflowNodes.config,
        position: workflowNodes.position,
      })
      .from(workflowNodes)
      .where(inArray(workflowNodes.workflowId, ids)),
    db
      .select({
        workflowId: workflowEdges.workflowId,
        id: workflowEdges.id,
        sourceNodeId: workflowEdges.sourceNodeId,
        targetNodeId: workflowEdges.targetNodeId,
        sourceHandle: workflowEdges.sourceHandle,
      })
      .from(workflowEdges)
      .where(inArray(workflowEdges.workflowId, ids)),
    db
      .select({
        workflowId: workflowSchedules.workflowId,
        type: workflowSchedules.type,
        config: workflowSchedules.config,
        enabled: workflowSchedules.enabled,
      })
      .from(workflowSchedules)
      .where(inArray(workflowSchedules.workflowId, ids)),
    db
      .selectDistinctOn([workflowRuns.workflowId], {
        workflowId: workflowRuns.workflowId,
        id: workflowRuns.id,
        status: workflowRuns.status,
        trigger: workflowRuns.trigger,
        startedAt: workflowRuns.startedAt,
        completedAt: workflowRuns.completedAt,
        error: workflowRuns.error,
      })
      .from(workflowRuns)
      // A test run proves a draft; it is not how the workflow is doing.
      .where(and(inArray(workflowRuns.workflowId, ids), eq(workflowRuns.mode, 'live')))
      .orderBy(workflowRuns.workflowId, sql`${workflowRuns.startedAt} DESC NULLS LAST`),
    readBuildStates(ids),
    // A proposals store that cannot be read must not take the list down with it.
    countPendingFixProposals().catch(() => new Map<string, number>()),
  ]);

  const group = <T extends { workflowId: string }>(items: T[]) => {
    const m = new Map<string, T[]>();
    for (const it of items) {
      const list = m.get(it.workflowId) ?? [];
      list.push(it);
      m.set(it.workflowId, list);
    }
    return m;
  };
  const nodesBy = group(nodes);
  const edgesBy = group(edges);
  const schedulesBy = group(schedules);
  const runBy = new Map(lastRuns.map((r) => [r.workflowId, r]));

  const cards = rows.map((row): WorkflowCardDTO => {
    const graphNodes = (nodesBy.get(row.id) ?? []).map((n) => ({
      ...n,
      config: (n.config ?? {}) as Record<string, unknown>,
    }));
    const graphEdges = edgesBy.get(row.id) ?? [];
    const run = runBy.get(row.id) ?? null;
    const build = builds.get(row.id) ?? NO_BUILD;
    return {
      slug: slugOf(row.name),
      title: titleOf(row),
      description: null,
      trigger: triggerFor(row, graphNodes, graphEdges, schedulesBy.get(row.id) ?? []),
      nodeCount: graphNodes.filter((n) => isStepNode(n, graphEdges)).length,
      lastRun: run ? runSummary(run) : null,
      ...attentionFor({ lastRun: run, buildError: build.buildError, pendingFixes: pendingFixes.get(row.id) ?? 0 }),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
  return sortWorkflowCards(cards);
}

// ———————————————————————————————————————————— detail

export interface StepDTO {
  id: string;
  type: string;
  label: string;
  category: string;
  icon: string | null;
  summary: string;
  config: Record<string, unknown>;
  form: FieldDTO[];
  next: Array<{ handle: string | null; targetId: string }>;
  legacy: boolean;
}

export interface WorkflowDetailDTO {
  slug: string;
  title: string;
  description: string | null;
  version: number;
  trigger: TriggerDTO;
  building: boolean;
  buildError: string | null;
  /** The last describe-it build's lint + test-run proof, when there is one. */
  verification: WorkflowVerification | null;
  steps: StepDTO[];
  edges: Array<{ id: string; source: string; target: string; sourceHandle: string | null }>;
  recentRuns: RunSummaryDTO[];
  fixProposals: FixProposalDTO[];
}

/**
 * A step's config as the phone may see it. The trigger node mirrors a webhook's
 * shared secret (so the canvas panel can offer "copy"); a phone has no webhook
 * editor, so the secret stays on the server. `update_node` merges, so leaving
 * it out of what the phone sends back does not clear it.
 */
function phoneConfig(node: GraphNode): Record<string, unknown> {
  if (node.type !== 'trigger' || !('secret' in node.config)) return node.config;
  const { secret: _secret, ...rest } = node.config;
  return rest;
}

export function stepFrom(node: GraphNode, edges: GraphEdge[]): StepDTO {
  const def = getDefinition(node.type);
  return {
    id: node.id,
    type: node.type,
    label: node.label,
    category: categoryOfType(node.type),
    icon: null,
    summary: summarizeNode(node.type, node.config, def?.description).line,
    config: phoneConfig(node),
    form: deriveFormFields(def),
    next: edges
      .filter((e) => e.sourceNodeId === node.id)
      .map((e) => ({ handle: e.sourceHandle ?? null, targetId: e.targetNodeId })),
    // No definition at all (a retired type, or a dynamic node this build does
    // not ship) or one hidden from the palette: it still runs, but the phone
    // should offer to replace it rather than to extend it.
    legacy: !def || def.hidden === true,
  };
}

export async function loadWorkflowDetail(workflow: Workflow): Promise<WorkflowDetailDTO> {
  const [{ nodes, edges }, schedules, runs, build, proposals] = await Promise.all([
    loadGraph(workflow.id),
    db
      .select({ type: workflowSchedules.type, config: workflowSchedules.config, enabled: workflowSchedules.enabled })
      .from(workflowSchedules)
      .where(eq(workflowSchedules.workflowId, workflow.id)),
    listRuns(workflow.id, 10),
    readBuildState(workflow.id),
    listFixProposals(workflow.id),
  ]);

  const stepNodes = orderSteps(
    nodes.filter((n) => isStepNode(n, edges)),
    edges,
  );
  const stepIds = new Set(stepNodes.map((n) => n.id));

  return {
    slug: slugOf(workflow.name),
    title: titleOf(workflow),
    description: null,
    version: graphVersion(nodes, edges),
    trigger: triggerFor(workflow, nodes, edges, schedules),
    building: build.building,
    buildError: build.buildError,
    verification: build.verification ?? null,
    steps: stepNodes.map((n) => stepFrom(n, edges)),
    edges: edges
      .filter((e) => stepIds.has(e.sourceNodeId) && stepIds.has(e.targetNodeId))
      .map((e) => ({ id: e.id, source: e.sourceNodeId, target: e.targetNodeId, sourceHandle: e.sourceHandle ?? null })),
    recentRuns: runs,
    // Pending self-heal fixes, in the same wire shape the canvas banner reads.
    fixProposals: proposals.map(toFixProposalDTO),
  };
}

// ———————————————————————————————————————————— runs

export async function listRuns(workflowId: string, limit: number, opts: { liveOnly?: boolean } = {}): Promise<RunSummaryDTO[]> {
  const rows = await db
    .select({
      id: workflowRuns.id,
      status: workflowRuns.status,
      trigger: workflowRuns.trigger,
      startedAt: workflowRuns.startedAt,
      completedAt: workflowRuns.completedAt,
      error: workflowRuns.error,
      mode: workflowRuns.mode,
    })
    .from(workflowRuns)
    .where(opts.liveOnly
      ? and(eq(workflowRuns.workflowId, workflowId), eq(workflowRuns.mode, 'live'))
      : eq(workflowRuns.workflowId, workflowId))
    .orderBy(sql`${workflowRuns.startedAt} DESC NULLS LAST`)
    .limit(limit);
  return rows.map(runSummary);
}

export interface RunStepDTO {
  nodeId: string;
  label: string;
  type: string;
  status: string;
  startedAt: string | null;
  durationMs: number | null;
  error: string | null;
  output: string | null;
  rows: number | null;
}

export async function loadRunDetail(
  runId: string,
): Promise<{ run: RunSummaryDTO; slug: string; steps: RunStepDTO[] } | null> {
  const [run] = await db
    .select({
      id: workflowRuns.id,
      workflowId: workflowRuns.workflowId,
      status: workflowRuns.status,
      trigger: workflowRuns.trigger,
      startedAt: workflowRuns.startedAt,
      completedAt: workflowRuns.completedAt,
      error: workflowRuns.error,
      mode: workflowRuns.mode,
      name: workflows.name,
    })
    .from(workflowRuns)
    .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
    .where(and(eq(workflowRuns.id, runId), like(workflows.name, `${CANVAS_PREFIX}%`)))
    .limit(1);
  if (!run) return null;

  const [execs, { nodes, edges }] = await Promise.all([
    db
      .select({
        nodeId: nodeExecutions.nodeId,
        status: nodeExecutions.status,
        startedAt: nodeExecutions.startedAt,
        completedAt: nodeExecutions.completedAt,
        error: nodeExecutions.error,
        outputData: nodeExecutions.outputData,
      })
      .from(nodeExecutions)
      .where(eq(nodeExecutions.runId, runId))
      .orderBy(asc(nodeExecutions.startedAt)),
    loadGraph(run.workflowId),
  ]);

  // Steps in the workflow's own order, so a run reads like its canvas; a node
  // deleted since the run keeps its execution but has no place in that order.
  const order = new Map(orderSteps(nodes, edges).map((n, i) => [n.id, i]));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const steps = execs
    .map((e): RunStepDTO => {
      const node = nodeById.get(e.nodeId);
      return {
        nodeId: e.nodeId,
        label: node?.label ?? e.nodeId,
        type: node?.type ?? 'unknown',
        status: e.status,
        startedAt: e.startedAt ? e.startedAt.toISOString() : null,
        durationMs: e.startedAt && e.completedAt ? e.completedAt.getTime() - e.startedAt.getTime() : null,
        error: e.error ?? null,
        output: outputPreview(e.outputData),
        rows: outputRows(e.outputData),
      };
    })
    .sort((a, b) => (order.get(a.nodeId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.nodeId) ?? Number.MAX_SAFE_INTEGER));

  return { run: runSummary(run), slug: slugOf(run.name), steps };
}
