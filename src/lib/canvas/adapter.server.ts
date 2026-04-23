import { db } from '$lib/db';
import {
  workflows,
  workflowNodes,
  workflowEdges,
  workflowRuns,
  nodeExecutions,
  openrouterModels,
  orchestratorChats,
} from '$lib/db/schema';
import { eq, desc, asc, and } from 'drizzle-orm';
import { GLM_MODELS, DEFAULT_GLM_MODEL_ID } from '$lib/constants/glm-models';
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

/** Pull the model catalogue the user configured on /admin/models. */
export async function loadModelCatalogue(): Promise<ModelCatalogue> {
  const [glmSetting, orAltSetting, orModels] = await Promise.all([
    getSetting<{ modelId?: string }>('jkai.chat.default_glm_model'),
    getSetting<{ modelId?: string } | null>('jkai.chat.alt_openrouter_model'),
    db
      .select({
        id: openrouterModels.id,
        name: openrouterModels.name,
      })
      .from(openrouterModels)
      .orderBy(asc(openrouterModels.id)),
  ]);

  const defaultGlmId = glmSetting?.modelId ?? DEFAULT_GLM_MODEL_ID;
  const altOrId = orAltSetting?.modelId ?? null;
  const defaultLabel = altOrId
    ? `Default → ${defaultGlmId} / alt: ${altOrId}`
    : `Default → ${defaultGlmId}`;

  return {
    defaultLabel,
    glm: GLM_MODELS.map((m) => ({ value: m.id, label: m.label })),
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
    label: 'glm-4-flash',
    x: COL[0],
    y: 40,
    config: {
      model: '',
      userPrompt:
        'Respond with VALID JSON only. Echo back the user message inside a {"echo": <message>} object. User message: {{input.message}}',
      temperature: 0,
      maxTokens: 256,
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
      maxTokens: 256,
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

/** All canvases (workflows whose name starts with "canvas:"). */
export async function listCanvases(): Promise<CanvasSummary[]> {
  const { like } = await import('drizzle-orm');
  const rows = await db
    .select()
    .from(workflows)
    .where(like(workflows.name, `${SLUG_PREFIX}%`))
    .orderBy(desc(workflows.updatedAt));

  const summaries: CanvasSummary[] = [];
  for (const w of rows) {
    const nodeCountRes = await db
      .select({ n: workflowNodes.id })
      .from(workflowNodes)
      .where(eq(workflowNodes.workflowId, w.id));
    const edgeCountRes = await db
      .select({ n: workflowEdges.id })
      .from(workflowEdges)
      .where(eq(workflowEdges.workflowId, w.id));
    const [latestRun] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, w.id))
      .orderBy(desc(workflowRuns.startedAt))
      .limit(1);
    const trigger = (w.trigger as { type?: string } | null) ?? {};
    summaries.push({
      slug: w.name.startsWith(SLUG_PREFIX) ? w.name.slice(SLUG_PREFIX.length) : w.name,
      title: w.description || w.name,
      workflowId: w.id,
      nodeCount: nodeCountRes.length,
      edgeCount: edgeCountRes.length,
      triggerType: trigger.type ?? 'manual',
      latestRunAt: latestRun?.startedAt ? new Date(latestRun.startedAt).toISOString() : null,
      latestRunStatus: latestRun?.status ?? null,
      updatedAt: new Date(w.updatedAt).toISOString(),
    });
  }
  return summaries;
}

/**
 * Create a fresh canvas — a workflow named `canvas:<slug>` seeded with a
 * single chat node and no edges. Rejects if the slug is already taken.
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

  const [triggerNode] = await db
    .insert(workflowNodes)
    .values({
      workflowId: created.id,
      type: 'trigger',
      label: 'Trigger',
      position: { x: 20, y: 20 },
      config: { kind: 'manual' },
    })
    .returning();

  const [chatNode] = await db
    .insert(workflowNodes)
    .values({
      workflowId: created.id,
      type: 'chat',
      label: 'Chat',
      position: { x: 260, y: 20 },
      config: { model: '', useIntelContext: true },
    })
    .returning();

  await db.insert(workflowEdges).values({
    workflowId: created.id,
    sourceNodeId: triggerNode.id,
    targetNodeId: chatNode.id,
  });

  return { workflowId: created.id, slug };
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
): Promise<{ workflowId: string; title: string }> {
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

  // Nothing matched — seed a fresh canvas under the slugified param.
  const seedSlug = _slugify(slugOrId) || slugOrId;
  const [created] = await db
    .insert(workflows)
    .values({
      name: workflowNameFor(seedSlug),
      description: SEED_TITLE,
      trigger: { type: 'manual' },
    })
    .returning();

  const idByLocal: Record<string, string> = {};
  for (const n of SEED_NODES) {
    const [row] = await db
      .insert(workflowNodes)
      .values({
        workflowId: created.id,
        type: n.type,
        label: n.label,
        position: { x: n.x, y: n.y },
        config: n.config,
      })
      .returning();
    idByLocal[n.localId] = row.id;
  }
  for (const e of SEED_EDGES) {
    await db.insert(workflowEdges).values({
      workflowId: created.id,
      sourceNodeId: idByLocal[e.from],
      targetNodeId: idByLocal[e.to],
    });
  }

  return { workflowId: created.id, title: SEED_TITLE };
}

/** Load a canvas view of a workflow, including latest run's node states. */
export async function loadCanvas(slug: string): Promise<Canvas> {
  const { workflowId, title } = await ensureCanvasWorkflow(slug);

  const nodes = await db
    .select()
    .from(workflowNodes)
    .where(eq(workflowNodes.workflowId, workflowId));
  const edges = await db
    .select()
    .from(workflowEdges)
    .where(eq(workflowEdges.workflowId, workflowId));

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

  // Pull messages for this workflow (covers legacy rows without a
  // conversationId) AND any rows linked only by conversationId.
  const msgRows = await db
    .select()
    .from(orchestratorChats)
    .where(eq(orchestratorChats.workflowId, workflowId))
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
  };
}
