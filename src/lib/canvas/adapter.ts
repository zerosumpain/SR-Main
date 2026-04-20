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
import { eq, desc, asc } from 'drizzle-orm';
import { GLM_MODELS, DEFAULT_GLM_MODEL_ID } from '$lib/constants/glm-models';
import { getSetting } from '$lib/server/models/settings';

export type NodeKind = 'input' | 'llm' | 'parse' | 'output' | 'intel' | 'agent' | 'chat';
export type NodeStatus = 'idle' | 'running' | 'ok' | 'failed';

export type CanvasNode = {
  id: string;
  kind: NodeKind;
  name: string;
  x: number;
  y: number;
  type: string; // workflow node type (e.g., "llm-call")
  config: Record<string, unknown>;
  status?: NodeStatus;
  inputData?: unknown;
  outputData?: unknown;
  error?: string | null;
  durationMs?: number | null;
};

export type CanvasEdge = {
  id: string;
  from: string;
  to: string;
  active?: boolean;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  runId?: string | null;
  nodeId?: string | null;
};

export type Canvas = {
  slug: string;
  title: string;
  workflowId: string;
  latestRunId: string | null;
  runStatus: string | null;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  messagesByChat: Record<string, ChatMessage[]>;
};

export type NodeTypeOption = {
  type: string;
  label: string;
  kind: NodeKind;
  description: string;
  defaultConfig: Record<string, unknown>;
};

/** Curated set of workflow node types offered in the canvas "+ node" picker. */
export const CANVAS_NODE_TYPES: NodeTypeOption[] = [
  {
    type: 'chat',
    label: 'Chat',
    kind: 'chat',
    description:
      'Chat panel with its own history. Standalone: full jkai chat (tools + memory + intel). Wired downstream: triggers the workflow.',
    defaultConfig: { model: '', useIntelContext: true },
  },
  {
    type: 'manual-trigger',
    label: 'Input · manual',
    kind: 'input',
    description: 'Workflow entry point. Accepts data from the Run button.',
    defaultConfig: {},
  },
  {
    type: 'llm-call',
    label: 'LLM · single call',
    kind: 'llm',
    description: 'Single LLM call with a prompt template.',
    defaultConfig: {
      model: '',
      userPrompt: '{{input.message}}',
      temperature: 0.7,
      maxTokens: 1024,
    },
  },
  {
    type: 'llm-agent',
    label: 'Agent · LLM with tools',
    kind: 'agent',
    description: 'Tool-calling agent loop. Downstream nodes become tools.',
    defaultConfig: { model: '', systemPrompt: '', userPrompt: '{{input.message}}' },
  },
  {
    type: 'text-parser',
    label: 'Parse · text',
    kind: 'parse',
    description: 'JSON / regex extraction from upstream response.',
    defaultConfig: { mode: 'json', inputField: 'response' },
  },
  {
    type: 'intel-query',
    label: 'Intel · query',
    kind: 'intel',
    description: 'Search the knowledge graph; appends matching context to downstream input.',
    defaultConfig: { query: '{{input.message}}' },
  },
  {
    type: 'intel-write',
    label: 'Intel · write',
    kind: 'intel',
    description: 'Write findings into the knowledge graph.',
    defaultConfig: {},
  },
  {
    type: 'transform',
    label: 'Output · transform',
    kind: 'output',
    description: 'Identity pass-through, or apply a JS expression.',
    defaultConfig: {},
  },
  {
    type: 'http-request',
    label: 'Input · HTTP request',
    kind: 'input',
    description: 'Fetch data from an external URL.',
    defaultConfig: { method: 'GET', url: '' },
  },
  {
    type: 'delay',
    label: 'Delay',
    kind: 'output',
    description: 'Pause N milliseconds before continuing.',
    defaultConfig: { ms: 1000 },
  },
  {
    type: 'conditional',
    label: 'Conditional branch',
    kind: 'parse',
    description: 'Route to one of two downstream handles based on a condition.',
    defaultConfig: { condition: 'input.ok' },
  },
];

export type ModelOption = { value: string; label: string };
export type ModelCatalogue = {
  defaultLabel: string; // what "" resolves to, for the first option
  glm: ModelOption[];
  openrouter: ModelOption[];
};

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

/** Map workflow node types to canvas visual kinds. */
export function mapTypeToKind(type: string): NodeKind {
  if (type === 'chat') return 'chat';
  if (type === 'manual-trigger' || type === 'http-request') return 'input';
  if (type === 'llm-agent') return 'agent';
  if (type === 'llm-call' || type === 'llm-router' || type === 'openrouter' || type === 'think')
    return 'llm';
  if (type === 'text-parser' || type === 'validator') return 'parse';
  if (type === 'intel-write' || type === 'intel-query' || type === 'deep-dive') return 'intel';
  return 'output';
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

/** Turn free text into a canvas slug: lowercase, kebab, trimmed to 48 chars. */
export function slugify(input: string): string {
  return (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 48);
}

export type CanvasSummary = {
  slug: string;
  title: string;
  workflowId: string;
  nodeCount: number;
  edgeCount: number;
  triggerType: string;
  latestRunAt: string | null;
  latestRunStatus: string | null;
  updatedAt: string;
};

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
  const slug = slugify(slugInput);
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

  await db.insert(workflowNodes).values({
    workflowId: created.id,
    type: 'chat',
    label: 'Chat',
    position: { x: 40, y: 40 },
    config: { model: '', useIntelContext: true },
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

/** Idempotently ensure a workflow exists for this slug; return its id + title. */
export async function ensureCanvasWorkflow(
  slug: string,
): Promise<{ workflowId: string; title: string }> {
  const name = workflowNameFor(slug);
  const [existing] = await db.select().from(workflows).where(eq(workflows.name, name));
  if (existing) {
    return { workflowId: existing.id, title: existing.description || SEED_TITLE };
  }

  const [created] = await db
    .insert(workflows)
    .values({ name, description: SEED_TITLE, trigger: { type: 'manual' } })
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

/** Identify terminal output node(s) — nodes with no outgoing edges. */
export function findTerminalNodeIds(
  nodes: { id: string }[],
  edges: { from: string; to: string }[],
): string[] {
  const hasOutgoing = new Set(edges.map((e) => e.from));
  return nodes.filter((n) => !hasOutgoing.has(n.id)).map((n) => n.id);
}

/** Extract a text reply from a terminal node's last outputData. */
export function terminalReplyText(outputData: unknown): string {
  if (outputData === null || outputData === undefined) return '';
  if (typeof outputData === 'string') return outputData;
  if (typeof outputData === 'object') {
    const obj = outputData as Record<string, unknown>;
    // Common shapes: { reply }, { response }, { text }, { content }, { output }
    for (const k of ['reply', 'response', 'text', 'content', 'output', 'message']) {
      const v = obj[k];
      if (typeof v === 'string' && v.trim()) return v;
    }
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }
  return String(outputData);
}
