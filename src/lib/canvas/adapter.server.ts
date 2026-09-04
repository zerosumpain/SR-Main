import { db } from '$lib/db';
import {
  workflows,
  workflowNodes,
  workflowEdges,
  workflowRuns,
  workflowSchedules,
  nodeExecutions,
  openrouterModels,
  orchestratorChats,
} from '$lib/db/schema';
import { eq, desc, asc, and, or, inArray } from 'drizzle-orm';
import { DEFAULT_CHAT_MODEL_ID } from '$lib/constants/default-models';
import { getSetting } from '$lib/server/models/settings';
import { slugify as _slugify } from './slug';
import { mapTypeToKind } from './adapter';
import type {
  Canvas,
  CanvasNode,
  CanvasEdge,
  ChatMessage,
  ModelOption,
  ModelCatalogue,
  NodeStatus,
  CanvasSummary,
} from './adapter';

export type {
  Canvas,
  CanvasNode,
  CanvasEdge,
  ChatMessage,
  ModelOption,
  ModelCatalogue,
  NodeStatus,
  CanvasSummary,
} from './adapter';

// GLM models surfaced in the canvas model picker. The direct z.ai provider
// was decommissioned (2026-07-17); GLM now bills through OpenRouter, so these
// carry full z-ai/* slugs as their values.
const GLM_MODELS: ModelOption[] = [
  { value: 'z-ai/glm-5-turbo', label: 'GLM 5 Turbo' },
  { value: 'z-ai/glm-5.1', label: 'GLM 5.1' },
  { value: 'z-ai/glm-5.2', label: 'GLM 5.2' },
];

/** Pull the model catalogue the user configured on /admin/ai/models. */
export async function loadModelCatalogue(): Promise<ModelCatalogue> {
  const [glmSetting, orAltSetting, orModels] = await Promise.all([
    getSetting<{ modelId?: string }>('jkai.chat.default_model'),
    getSetting<{ modelId?: string } | null>('jkai.chat.alt_openrouter_model'),
    db
      .select({
        id: openrouterModels.id,
        name: openrouterModels.name,
      })
      .from(openrouterModels)
      .orderBy(asc(openrouterModels.id)),
  ]);

  const defaultGlmId = glmSetting?.modelId ?? DEFAULT_CHAT_MODEL_ID;
  const altOrId = orAltSetting?.modelId ?? null;
  const defaultLabel = altOrId
    ? `Default → ${defaultGlmId} / alt: ${altOrId}`
    : `Default → ${defaultGlmId}`;

  return {
    defaultLabel,
    glm: GLM_MODELS.map((m) => ({ value: m.value, label: m.label })),
    openrouter: orModels.map((m) => ({
      value: m.id,
      label: m.name ? `${m.name} (${m.id})` : m.id,
    })),
  };
}

function mapExecStatus(s: string | null | undefined): NodeStatus | undefined {
  if (!s) return undefined;
  if (s === 'running' || s === 'healing') return 'running';
  if (s === 'completed') return 'ok';
  if (s === 'failed') return 'failed';
  return undefined;
}

/* ————————————————————————————————————————————————————————
 * Seed — the default "canvas-sample" workflow.
 * Layout mirrors the canvas column grid [320, 540, 760, 980].
 * ———————————————————————————————————————————————————————— */
// Chat is wide (300×360); rest of the canvas uses the regular 148×52 nodes.
const COL = [360, 560, 740, 920] as const;

type SeedNode = {
  localId: string; // referenced by seed edges
  type: string;
  label: string;
  x: number;
  y: number;
  config: Record<string, unknown>;
};

const SEED_NODES: SeedNode[] = [
  {
    localId: 'chat',
    type: 'chat',
    label: 'Chat',
    x: 20,
    y: 20,
    config: { model: '', useIntelContext: true },
  },
  {
    localId: 'llm_primary',
    type: 'llm-call',
    label: 'GLM 5.2',
    x: COL[0],
    y: 40,
    // maxTokens deliberately unset — a seeded node inherits the definition's
    // default like any other newly built LLM node.
    config: {
      model: '',
      userPrompt:
        'Respond with VALID JSON only. Echo back the user message inside a {"echo": <message>} object. User message: {{input.message}}',
      temperature: 0,
    },
  },
  {
    localId: 'parser',
    type: 'text-parser',
    label: 'JSON.parse',
    x: COL[0],
    y: 160,
    config: { mode: 'json', inputField: 'response' },
  },
  {
    localId: 'llm_retry',
    type: 'llm-call',
    label: 'claude-haiku-4-5',
    x: COL[1],
    y: 160,
    config: {
      model: '',
      userPrompt:
        'You are a JSON repair engine. Return ONLY a valid JSON object. Upstream output: {{input.response}}',
      temperature: 0,
    },
  },
  {
    localId: 'output',
    type: 'transform',
    label: 'Reply',
    x: COL[2],
    y: 160,
    config: {},
  },
];

const SEED_EDGES: Array<{ from: string; to: string }> = [
  { from: 'chat', to: 'llm_primary' },
  { from: 'llm_primary', to: 'parser' },
  { from: 'parser', to: 'llm_retry' },
  { from: 'llm_retry', to: 'output' },
];

const SEED_TITLE = 'self-healing json retry';

/** Workflow name we use to key canvas slugs: "canvas:<slug>". */
function workflowNameFor(slug: string): string {
  return `canvas:${slug}`;
}

const SLUG_PREFIX = 'canvas:';

/**
 * Self-heal zombie `awaiting_human` runs for this workflow.
 *
 * An interactive-step node opens a `workflow_interactions` row with an
 * `expires_at`. If the user never resolves the interaction (often because
 * no VNC session was spawned) the run stays paused indefinitely with
 * status `awaiting_human`, and the canvas page hydrates it as an active
 * run that polls endlessly and blocks new work.
 *
 * This reaper runs on every canvas page load: any interaction whose
 * `expires_at` is in the past and that has neither `resolved_at` nor
 * `cancelled` gets marked cancelled, the owning run is marked failed,
 * and we emit `run_failed` on the event bus so any still-connected SSE
 * subscriber closes out.
 */
export async function reapExpiredInteractions(workflowId: string): Promise<number> {
  const { lt, isNull } = await import('drizzle-orm');
  const { workflowInteractions, workflowRuns } = await import('$lib/db/schema');
  const { emitWorkflowEvent } = await import('$lib/workflows/events');

  const expired = await db
    .select({
      id: workflowInteractions.id,
      runId: workflowInteractions.runId,
      nodeId: workflowInteractions.nodeId,
    })
    .from(workflowInteractions)
    .innerJoin(workflowRuns, eq(workflowRuns.id, workflowInteractions.runId))
    .where(
      and(
        eq(workflowRuns.workflowId, workflowId),
        eq(workflowRuns.status, 'awaiting_human'),
        eq(workflowInteractions.cancelled, false),
        isNull(workflowInteractions.resolvedAt),
        lt(workflowInteractions.expiresAt, new Date()),
      ),
    );

  if (expired.length === 0) return 0;

  const reapedRunIds = new Set<string>();
  for (const row of expired) {
    await db
      .update(workflowInteractions)
      .set({ cancelled: true, resolvedAt: new Date() })
      .where(eq(workflowInteractions.id, row.id));
    reapedRunIds.add(row.runId);
  }

  for (const runId of reapedRunIds) {
    const message = 'Interactive step expired without user input — run aborted.';
    await db
      .update(workflowRuns)
      .set({ status: 'failed', completedAt: new Date(), error: message })
      .where(eq(workflowRuns.id, runId));
    emitWorkflowEvent({
      runId,
      timestamp: new Date().toISOString(),
      type: 'run_failed',
      data: { error: message },
    });
  }

  console.log(
    `[canvas] reaped ${expired.length} expired interaction(s) across ${reapedRunIds.size} run(s) in workflow ${workflowId}`,
  );
  return reapedRunIds.size;
}

/**
 * Allocate a unique `canvas:<slug>` name from a free-form seed (typically a
 * user-supplied title or the orchestrator's generated workflow.name). This is
 * the single place every non-canvas insert site must route through so that
 * every workflow row is addressable as a canvas — the canvas index filters by
 * the `canvas:` prefix, so any row missing it becomes invisible in the UI but
 * still shows up to the LLM via `workflow_list` (which is how it ends up
 * claiming a "workflow already exists" for something the user can't see).
 *
 * Clips the slug to 40 chars to keep URLs tidy, then appends `-2`, `-3`, ...
 * on collision. Never throws — falls back to a uuid-derived slug if the seed
 * slugifies to empty.
 */
export async function allocateCanvasName(seed: string): Promise<{ name: string; slug: string }> {
  const raw = _slugify(seed);
  const baseSlug = (raw || `canvas-${crypto.randomUUID().slice(0, 8)}`).slice(0, 40);
  let slug = baseSlug;
  let attempt = 1;
  while (attempt < 100) {
    const [clash] = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(eq(workflows.name, workflowNameFor(slug)));
    if (!clash) return { name: workflowNameFor(slug), slug };
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }
  // Astronomically unlikely — 100 collisions in a row — but fall back to uuid.
  slug = `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;
  return { name: workflowNameFor(slug), slug };
}

export type CanvasStats = {
  canvasCount: number;
  nodeCount: number;
  edgeCount: number;
  runs7d: number;
  successRate7d: number | null;
  /** One bucket per day, oldest first, seven long — the health board's
   *  runs histogram. `failed` is a subset of `total`. */
  runsByDay: { date: string; label: string; total: number; failed: number }[];
  /** Node kinds across every canvas, commonest first. Kind, not raw type:
   *  the board is asking "what is this estate made of", and mapTypeToKind is
   *  the same grouping the canvas editor palette uses. */
  nodeMix: { kind: string; count: number }[];
  /** The next few enabled schedules that will actually fire, soonest first. */
  nextScheduled: { slug: string; title: string; at: string }[];
};

/** Aggregate counts across all canvases (last 7 days for run stats). */
export async function listCanvasStats(): Promise<CanvasStats> {
  const { like, gte, inArray, sql: sqlTag } = await import('drizzle-orm');
  const canvasRows = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(like(workflows.name, `${SLUG_PREFIX}%`));
  const ids = canvasRows.map((r) => r.id);
  if (ids.length === 0) {
    return {
      canvasCount: 0,
      nodeCount: 0,
      edgeCount: 0,
      runs7d: 0,
      successRate7d: null,
      runsByDay: [],
      nodeMix: [],
      nextScheduled: [],
    };
  }
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [nodeAgg] = await db
    .select({ n: sqlTag<number>`count(*)::int` })
    .from(workflowNodes)
    .where(inArray(workflowNodes.workflowId, ids));
  const [edgeAgg] = await db
    .select({ n: sqlTag<number>`count(*)::int` })
    .from(workflowEdges)
    .where(inArray(workflowEdges.workflowId, ids));
  const recentRuns = await db
    .select({ status: workflowRuns.status, startedAt: workflowRuns.startedAt })
    .from(workflowRuns)
    .where(
      and(inArray(workflowRuns.workflowId, ids), gte(workflowRuns.startedAt, sevenDaysAgo)),
    );
  const runs7d = recentRuns.length;
  const terminal = recentRuns.filter((r) => r.status === 'completed' || r.status === 'failed');
  const successRate7d =
    terminal.length === 0
      ? null
      : terminal.filter((r) => r.status === 'completed').length / terminal.length;

  // Seven day-buckets, oldest first, keyed on local calendar day so "today" is
  // the last bar rather than a rolling 24h window that never lines up with the
  // day labels beneath it.
  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const buckets = new Map<string, { date: string; label: string; total: number; failed: number }>();
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    buckets.set(dayKey(d), {
      date: d.toISOString(),
      label: d.toLocaleDateString('en-GB', { weekday: 'short' }),
      total: 0,
      failed: 0,
    });
  }
  for (const r of recentRuns) {
    if (!r.startedAt) continue;
    const b = buckets.get(dayKey(new Date(r.startedAt)));
    if (!b) continue;
    b.total += 1;
    if (r.status === 'failed' || r.status === 'completed_with_errors') b.failed += 1;
  }

  const nodeTypeRows = await db
    .select({ type: workflowNodes.type })
    .from(workflowNodes)
    .where(inArray(workflowNodes.workflowId, ids));
  const mix = new Map<string, number>();
  for (const n of nodeTypeRows) {
    const kind = mapTypeToKind(n.type);
    mix.set(kind, (mix.get(kind) ?? 0) + 1);
  }
  const nodeMix = [...mix.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // The scheduler keeps nextRunAt current, so this is what will actually fire —
  // not a cron string re-parsed here and liable to disagree with it.
  const scheduleRows = await db
    .select({
      workflowId: workflowSchedules.workflowId,
      nextRunAt: workflowSchedules.nextRunAt,
      name: workflows.name,
    })
    .from(workflowSchedules)
    .innerJoin(workflows, eq(workflows.id, workflowSchedules.workflowId))
    .where(
      and(
        inArray(workflowSchedules.workflowId, ids),
        eq(workflowSchedules.enabled, true),
        gte(workflowSchedules.nextRunAt, new Date()),
      ),
    )
    .orderBy(asc(workflowSchedules.nextRunAt))
    .limit(4);
  const nextScheduled = scheduleRows
    .filter((r) => r.nextRunAt)
    .map((r) => {
      const slug = r.name.startsWith(SLUG_PREFIX) ? r.name.slice(SLUG_PREFIX.length) : r.name;
      return { slug, title: slug.replace(/-/g, ' '), at: r.nextRunAt!.toISOString() };
    });

  return {
    canvasCount: ids.length,
    nodeCount: nodeAgg?.n ?? 0,
    edgeCount: edgeAgg?.n ?? 0,
    runs7d,
    successRate7d,
    runsByDay: [...buckets.values()],
    nodeMix,
    nextScheduled,
  };
}

/** All canvases (workflows whose name starts with "canvas:"). */
export async function listCanvases(): Promise<CanvasSummary[]> {
  const { like, sql: sqlTag } = await import('drizzle-orm');
  const rows = await db
    .select({
      id: workflows.id,
      name: workflows.name,
      description: workflows.description,
      trigger: workflows.trigger,
      updatedAt: workflows.updatedAt,
    })
    .from(workflows)
    .where(like(workflows.name, `${SLUG_PREFIX}%`))
    .orderBy(desc(workflows.updatedAt));

  if (rows.length === 0) return [];
  const workflowIds = rows.map((row) => row.id);

  // Fetch all summary data in three grouped queries. The previous loop issued
  // three sequential queries per canvas (1 + 3N total), so the page slowed
  // linearly with every canvas added.
  const [nodeCounts, edgeCounts, latestRuns] = await Promise.all([
    db
      .select({
        workflowId: workflowNodes.workflowId,
        n: sqlTag<number>`count(*)::int`,
      })
      .from(workflowNodes)
      .where(inArray(workflowNodes.workflowId, workflowIds))
      .groupBy(workflowNodes.workflowId),
    db
      .select({
        workflowId: workflowEdges.workflowId,
        n: sqlTag<number>`count(*)::int`,
      })
      .from(workflowEdges)
      .where(inArray(workflowEdges.workflowId, workflowIds))
      .groupBy(workflowEdges.workflowId),
    db
      .selectDistinctOn([workflowRuns.workflowId], {
        workflowId: workflowRuns.workflowId,
        status: workflowRuns.status,
        startedAt: workflowRuns.startedAt,
      })
      .from(workflowRuns)
      .where(inArray(workflowRuns.workflowId, workflowIds))
      .orderBy(workflowRuns.workflowId, desc(workflowRuns.startedAt)),
  ]);

  const nodeCountByWorkflow = new Map(nodeCounts.map((row) => [row.workflowId, row.n]));
  const edgeCountByWorkflow = new Map(edgeCounts.map((row) => [row.workflowId, row.n]));
  const latestRunByWorkflow = new Map(latestRuns.map((row) => [row.workflowId, row]));

  return rows.map((w) => {
    const latestRun = latestRunByWorkflow.get(w.id);
    const trigger = (w.trigger as { type?: string } | null) ?? {};
    return {
      slug: w.name.startsWith(SLUG_PREFIX) ? w.name.slice(SLUG_PREFIX.length) : w.name,
      title: w.description || w.name,
      workflowId: w.id,
      nodeCount: nodeCountByWorkflow.get(w.id) ?? 0,
      edgeCount: edgeCountByWorkflow.get(w.id) ?? 0,
      triggerType: trigger.type ?? 'manual',
      latestRunAt: latestRun?.startedAt ? new Date(latestRun.startedAt).toISOString() : null,
      latestRunStatus: latestRun?.status ?? null,
      updatedAt: new Date(w.updatedAt).toISOString(),
    };
  });
}

/**
 * Create a fresh canvas — a workflow named `canvas:<slug>` seeded with a
 * trigger node and a chat node, deliberately *not* wired together. The
 * unwired chat node acts as the canvas orchestrator panel (the
 * jkai-canvas, design-first edit flow). If the user later wires it into
 * the DAG it becomes a workflow step. Rejects if the slug is already taken.
 */
export async function createCanvas(
  slugInput: string,
  title: string,
): Promise<{ workflowId: string; slug: string }> {
  const slug = _slugify(slugInput);
  if (!slug) throw new Error('Slug is required (letters, numbers, dashes).');
  const name = workflowNameFor(slug);
  const [existing] = await db.select().from(workflows).where(eq(workflows.name, name));
  if (existing) throw new Error(`Canvas "${slug}" already exists.`);

  const [created] = await db
    .insert(workflows)
    .values({
      name,
      description: title.trim() || slug,
      trigger: { type: 'manual' },
    })
    .returning();

  await db
    .insert(workflowNodes)
    .values({
      workflowId: created.id,
      type: 'trigger',
      label: 'Trigger',
      position: { x: 20, y: 20 },
      config: { kind: 'manual' },
    });

  // Chat sits off to the right so it doesn't collide with the auto-layout
  // grid `workflow_add_node` uses (columns at x=240/520/800). No seed edge
  // — the user wires it in when they want it to play a role in execution;
  // until then it's the canvas orchestrator panel.
  await db
    .insert(workflowNodes)
    .values({
      workflowId: created.id,
      type: 'chat',
      label: 'Chat',
      position: { x: 1100, y: 20 },
      config: { model: '', useIntelContext: true },
    });

  return { workflowId: created.id, slug };
}

/**
 * Server-side canvas duplicate: copy the workflow row (fresh slug via
 * allocateCanvasName), all nodes (new ids, old→new remapped), and all edges.
 * The copy gets NO schedule row — a cloned monitor/cron workflow must not
 * silently start running twice; re-arm the schedule on the copy explicitly.
 */
export async function duplicateCanvas(slug: string): Promise<{ workflowId: string; slug: string } | null> {
  const name = workflowNameFor(slug);
  const [src] = await db.select().from(workflows).where(eq(workflows.name, name));
  if (!src) return null;

  const srcNodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, src.id));
  const srcEdges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, src.id));

  const { name: copyName, slug: copySlug } = await allocateCanvasName(`${slug}-copy`);
  const title = `${src.description || slug} (copy)`;

  const workflowId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(workflows)
      .values({
        name: copyName,
        description: title,
        trigger: src.trigger ?? { type: 'manual' },
        // Deliberately NOT copied: notifications (opt back in per-copy).
      })
      .returning();

    // Nodes get fresh DB ids; remember the mapping so edges stay wired.
    const idMap = new Map<string, string>();
    for (const n of srcNodes) {
      const [created2] = await tx
        .insert(workflowNodes)
        .values({
          workflowId: created.id,
          type: n.type,
          label: n.label,
          position: n.position,
          config: n.config,
        })
        .returning({ id: workflowNodes.id });
      idMap.set(n.id, created2.id);
    }
    for (const e of srcEdges) {
      const sourceNodeId = idMap.get(e.sourceNodeId);
      const targetNodeId = idMap.get(e.targetNodeId);
      if (!sourceNodeId || !targetNodeId) continue; // orphan edge in source — skip
      await tx.insert(workflowEdges).values({
        workflowId: created.id,
        sourceNodeId,
        targetNodeId,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      });
    }
    return created.id;
  });

  return { workflowId, slug: copySlug };
}

/** Portable canvas JSON (export/import). Positions/config carried verbatim;
 *  node ids are local to the file and remapped on import. */
export interface CanvasExport {
  version: 1;
  title: string;
  slug: string;
  trigger: unknown;
  nodes: Array<{ id: string; type: string; label: string; position: unknown; config: unknown }>;
  edges: Array<{ sourceNodeId: string; targetNodeId: string; sourceHandle: string | null; targetHandle: string | null }>;
}

/** Serialise a canvas to portable JSON. */
export async function exportCanvas(slug: string): Promise<CanvasExport | null> {
  const name = workflowNameFor(slug);
  const [src] = await db.select().from(workflows).where(eq(workflows.name, name));
  if (!src) return null;
  const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, src.id));
  const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, src.id));
  return {
    version: 1,
    title: src.description || slug,
    slug,
    trigger: src.trigger ?? { type: 'manual' },
    nodes: nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, position: n.position, config: n.config })),
    edges: edges.map((e) => ({
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
  };
}

/** Recreate a canvas from portable JSON under a fresh slug. Same id-remap +
 *  no-schedule rules as duplicateCanvas. Caps guard against junk files. */
export async function importCanvas(data: CanvasExport): Promise<{ workflowId: string; slug: string }> {
  if (!data || data.version !== 1 || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw new Error('Not a canvas export file (expected {version:1, nodes, edges}).');
  }
  if (data.nodes.length > 200 || data.edges.length > 500) {
    throw new Error('Canvas export too large (max 200 nodes / 500 edges).');
  }
  const seed = typeof data.slug === 'string' && data.slug ? data.slug : 'imported';
  const { name: copyName, slug: copySlug } = await allocateCanvasName(seed);
  const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : copySlug;

  const workflowId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(workflows)
      .values({
        name: copyName,
        description: title,
        trigger: (data.trigger as Record<string, unknown>) ?? { type: 'manual' },
      })
      .returning();
    const idMap = new Map<string, string>();
    for (const n of data.nodes) {
      if (typeof n.type !== 'string' || !n.type) continue;
      const [created2] = await tx
        .insert(workflowNodes)
        .values({
          workflowId: created.id,
          type: n.type,
          label: typeof n.label === 'string' && n.label ? n.label : n.type,
          position:
            n.position && typeof n.position === 'object'
              ? (n.position as { x: number; y: number })
              : { x: 40, y: 40 },
          config: n.config && typeof n.config === 'object' ? (n.config as Record<string, unknown>) : {},
        })
        .returning({ id: workflowNodes.id });
      if (typeof n.id === 'string') idMap.set(n.id, created2.id);
    }
    for (const e of data.edges) {
      const sourceNodeId = idMap.get(String(e.sourceNodeId));
      const targetNodeId = idMap.get(String(e.targetNodeId));
      if (!sourceNodeId || !targetNodeId) continue;
      await tx.insert(workflowEdges).values({
        workflowId: created.id,
        sourceNodeId,
        targetNodeId,
        sourceHandle: typeof e.sourceHandle === 'string' ? e.sourceHandle : null,
        targetHandle: typeof e.targetHandle === 'string' ? e.targetHandle : null,
      });
    }
    return created.id;
  });

  return { workflowId, slug: copySlug };
}

/** Drop a canvas and everything cascaded to it. */
export async function deleteCanvas(slug: string): Promise<boolean> {
  const name = workflowNameFor(slug);
  const res = await db.delete(workflows).where(eq(workflows.name, name)).returning({
    id: workflows.id,
  });
  return res.length > 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Idempotently ensure a workflow exists for this slug; return its id + title. */
export async function ensureCanvasWorkflow(
  slugOrId: string,
): Promise<{ workflowId: string; title: string } | null> {
  // Canvas-named lookup first (the post-migration happy path)
  const [byName] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.name, workflowNameFor(slugOrId)));
  if (byName) {
    return { workflowId: byName.id, title: byName.description || SEED_TITLE };
  }

  // UUID param? Look up directly by id.
  if (UUID_RE.test(slugOrId)) {
    const [byId] = await db.select().from(workflows).where(eq(workflows.id, slugOrId));
    if (byId) return { workflowId: byId.id, title: byId.description || byId.name };
  }

  // Legacy fallback: pre-migration workflow with a plain name match.
  const [legacy] = await db.select().from(workflows).where(eq(workflows.name, slugOrId));
  if (legacy) return { workflowId: legacy.id, title: legacy.description || legacy.name };

  // Nothing matched. Previously this branch silently auto-seeded a fresh
  // placeholder canvas for the unknown slug — but that turned out to be
  // a footgun: every time the chat orchestrator's reply contained a wrong
  // /jkai/canvas/<slug> URL (e.g. it hallucinated `generated-workflow-3`),
  // visiting that link spawned a junk canvas with the seed nodes and the
  // SEED_TITLE description. Now we return null and let the caller 404.
  return null;
}

/** Load a canvas view of a workflow, including latest run's node states.
 *  Returns null when the slug doesn't match any existing canvas. */
export async function loadCanvas(slug: string): Promise<Canvas | null> {
  const found = await ensureCanvasWorkflow(slug);
  if (!found) return null;
  const { workflowId, title } = found;

  const nodes = await db
    .select()
    .from(workflowNodes)
    .where(eq(workflowNodes.workflowId, workflowId));
  const edges = await db
    .select()
    .from(workflowEdges)
    .where(eq(workflowEdges.workflowId, workflowId));

  // D1 — per-workflow run-outcome notification prefs (null when never set).
  const [wfRow] = await db
    .select({ notifications: workflows.notifications })
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .limit(1);

  // Latest run (may not exist yet)
  const [latestRun] = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, workflowId))
    .orderBy(desc(workflowRuns.startedAt))
    .limit(1);

  const execByNode: Record<
    string,
    { status: string; inputData: unknown; outputData: unknown; error: string | null; startedAt: Date | null; completedAt: Date | null }
  > = {};
  if (latestRun) {
    const execs = await db
      .select()
      .from(nodeExecutions)
      .where(eq(nodeExecutions.runId, latestRun.id));
    for (const ex of execs) {
      execByNode[ex.nodeId] = {
        status: ex.status,
        inputData: ex.inputData,
        outputData: ex.outputData,
        error: ex.error,
        startedAt: ex.startedAt,
        completedAt: ex.completedAt,
      };
    }
  }

  const activeEdgeKeys = new Set<string>();
  for (const n of nodes) {
    const exec = execByNode[n.id];
    if (exec?.status === 'running' || exec?.status === 'healing') {
      // mark inbound edges as active
      for (const e of edges) if (e.targetNodeId === n.id) activeEdgeKeys.add(e.id);
    }
  }

  const canvasNodes: CanvasNode[] = nodes.map((n) => {
    const pos = (n.position as { x?: number; y?: number }) || {};
    const ex = execByNode[n.id];
    const dur =
      ex?.startedAt && ex?.completedAt
        ? new Date(ex.completedAt).getTime() - new Date(ex.startedAt).getTime()
        : null;
    return {
      id: n.id,
      kind: mapTypeToKind(n.type),
      name: n.label,
      x: typeof pos.x === 'number' ? pos.x : 0,
      y: typeof pos.y === 'number' ? pos.y : 0,
      type: n.type,
      config: (n.config as Record<string, unknown>) || {},
      status: mapExecStatus(ex?.status),
      inputData: ex?.inputData ?? undefined,
      outputData: ex?.outputData ?? undefined,
      error: ex?.error ?? null,
      durationMs: dur,
      version: n.version,
    };
  });

  const canvasEdges: CanvasEdge[] = edges.map((e) => ({
    id: e.id,
    from: e.sourceNodeId,
    to: e.targetNodeId,
    active: activeEdgeKeys.has(e.id),
  }));

  // Chat history — one bucket per chat node, sourced either from a
  // pinned conversationId (preferred) or from the metadata.chatNodeId
  // tag on orchestrator_chats rows.
  const chatNodes = nodes.filter((n) => n.type === 'chat');
  const chatNodeIds = chatNodes.map((n) => n.id);
  const messagesByChat: Record<string, ChatMessage[]> = {};
  for (const id of chatNodeIds) messagesByChat[id] = [];

  // Pull the per-node conversationId (if any) from node.config
  const conversationIdByNode: Record<string, string> = {};
  const conversationIdToNode: Record<string, string> = {};
  for (const n of chatNodes) {
    const cfg = (n.config as Record<string, unknown> | null) ?? {};
    const cid = typeof cfg.conversationId === 'string' ? (cfg.conversationId as string) : null;
    if (cid) {
      conversationIdByNode[n.id] = cid;
      conversationIdToNode[cid] = n.id;
    }
  }

  // Pull messages for this workflow AND any rows whose conversationId is
  // pinned onto one of this canvas's chat nodes (e.g. a jkai conversation
  // that was forwarded onto the canvas via ?conv=). The OR-clause is what
  // lets a /jkai conversation thread "follow" the user onto the canvas.
  const pinnedConversationIds = Object.values(conversationIdByNode);
  const msgRows = await db
    .select()
    .from(orchestratorChats)
    .where(
      pinnedConversationIds.length > 0
        ? or(
            eq(orchestratorChats.workflowId, workflowId),
            inArray(orchestratorChats.conversationId, pinnedConversationIds),
          )
        : eq(orchestratorChats.workflowId, workflowId),
    )
    .orderBy(desc(orchestratorChats.createdAt))
    .limit(400);

  const legacyBucket = chatNodeIds[0] ?? null;

  for (const m of msgRows.slice().reverse()) {
    const meta = (m.metadata as Record<string, unknown> | null) || {};
    const msg: ChatMessage = {
      id: m.id,
      role: (m.role as ChatMessage['role']) ?? 'user',
      content: m.content,
      createdAt: new Date(m.createdAt).toISOString(),
      runId: (meta.runId as string | undefined) ?? null,
      nodeId: (meta.nodeId as string | undefined) ?? null,
    };
    // Prefer conversationId routing, fall back to metadata tag, fall
    // back to the first chat node for ancient un-tagged rows.
    const byConversation = m.conversationId
      ? conversationIdToNode[m.conversationId] ?? null
      : null;
    const byMeta = typeof meta.chatNodeId === 'string' ? meta.chatNodeId : null;
    const bucket = byConversation ?? byMeta ?? legacyBucket;
    if (bucket && messagesByChat[bucket]) messagesByChat[bucket].push(msg);
  }

  return {
    slug,
    title,
    workflowId,
    latestRunId: latestRun?.id ?? null,
    runStatus: latestRun?.status ?? null,
    nodes: canvasNodes,
    edges: canvasEdges,
    messagesByChat,
    notifications: wfRow?.notifications ?? null,
  };
}
