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

export type NodeKind =
  | 'input'
  | 'llm'
  | 'parse'
  | 'output'
  | 'intel'
  | 'agent'
  | 'chat'
  | 'trigger'
  | 'inspector';
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
  group: string;
  description: string;
  defaultConfig: Record<string, unknown>;
};

export const CANVAS_NODE_GROUPS = [
  'Trigger & Flow',
  'LLM & AI',
  'Parse & Transform',
  'Intel & Web',
  'Integrations',
] as const;

/** Curated set of workflow node types offered in the canvas "+ node" picker. */
export const CANVAS_NODE_TYPES: NodeTypeOption[] = [
  // ————————————————————————— Trigger & Flow
  {
    type: 'trigger',
    label: 'Trigger',
    kind: 'trigger',
    group: 'Trigger & Flow',
    description:
      'Workflow entry point — manual / cron / webhook / event. Exactly one per canvas.',
    defaultConfig: { kind: 'manual' },
  },
  {
    type: 'chat',
    label: 'Chat',
    kind: 'chat',
    group: 'Trigger & Flow',
    description:
      'Chat panel with its own history. Standalone: full jkai chat (tools + memory + intel). Wired downstream: triggers the workflow.',
    defaultConfig: { model: '', useIntelContext: true },
  },
  {
    type: 'conditional',
    label: 'Conditional',
    kind: 'parse',
    group: 'Trigger & Flow',
    description: 'Route to one of two downstream handles based on a JS expression.',
    defaultConfig: { condition: 'input.ok' },
  },
  {
    type: 'loop',
    label: 'Loop',
    kind: 'output',
    group: 'Trigger & Flow',
    description: 'Iterate over an array; downstream runs once per item.',
    defaultConfig: { items: '{{input.items}}', maxIterations: 100 },
  },
  {
    type: 'delay',
    label: 'Delay',
    kind: 'output',
    group: 'Trigger & Flow',
    description: 'Pause N milliseconds before continuing.',
    defaultConfig: { ms: 1000 },
  },
  {
    type: 'error-handler',
    label: 'Error handler',
    kind: 'output',
    group: 'Trigger & Flow',
    description: 'Catch downstream failures and route to a recovery branch.',
    defaultConfig: {},
  },
  {
    type: 'sub-workflow',
    label: 'Sub-workflow',
    kind: 'output',
    group: 'Trigger & Flow',
    description: 'Call another canvas as a reusable block.',
    defaultConfig: { workflowId: '' },
  },

  // ————————————————————————— LLM & AI
  {
    type: 'llm-call',
    label: 'LLM call',
    kind: 'llm',
    group: 'LLM & AI',
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
    label: 'LLM agent (tool-calling)',
    kind: 'agent',
    group: 'LLM & AI',
    description: 'Agent loop. Downstream nodes are discovered as tools the model can call.',
    defaultConfig: {
      model: '',
      systemPrompt: '',
      userPrompt: '{{input.message}}',
      maxIterations: 10,
    },
  },
  {
    type: 'llm-router',
    label: 'LLM router',
    kind: 'llm',
    group: 'LLM & AI',
    description: 'LLM classifies input and routes to a named downstream handle.',
    defaultConfig: { model: '', prompt: '' },
  },
  {
    type: 'think',
    label: 'Think',
    kind: 'llm',
    group: 'LLM & AI',
    description: 'Hidden reasoning step — LLM plans but does not emit the reasoning.',
    defaultConfig: { model: '', prompt: '' },
  },
  {
    type: 'openrouter',
    label: 'OpenRouter',
    kind: 'llm',
    group: 'LLM & AI',
    description: 'Direct OpenRouter completion (explicit model id).',
    defaultConfig: { model: 'openai/gpt-4o-mini' },
  },

  // ————————————————————————— Parse & Transform
  {
    type: 'text-parser',
    label: 'Text parser (JSON / regex)',
    kind: 'parse',
    group: 'Parse & Transform',
    description: 'Extract JSON or regex matches from an upstream string.',
    defaultConfig: { mode: 'json', inputField: 'response' },
  },
  {
    type: 'validator',
    label: 'Validator (schema)',
    kind: 'parse',
    group: 'Parse & Transform',
    description: 'Check input against a JSON schema. Pass or fail downstream.',
    defaultConfig: { schema: {} },
  },
  {
    type: 'transform',
    label: 'Transform (JS)',
    kind: 'output',
    group: 'Parse & Transform',
    description: 'Identity pass-through, or apply a JS expression to reshape data.',
    defaultConfig: {},
  },
  {
    type: 'code-execute',
    label: 'Code execute',
    kind: 'output',
    group: 'Parse & Transform',
    description: 'Run arbitrary JS in a sandbox; input/output passed through `input`/`return`.',
    defaultConfig: { code: 'return { ...input };' },
  },
  {
    type: 'merge',
    label: 'Merge',
    kind: 'output',
    group: 'Parse & Transform',
    description: 'Combine multiple upstream outputs into one object.',
    defaultConfig: {},
  },
  {
    type: 'accumulator',
    label: 'Accumulator',
    kind: 'output',
    group: 'Parse & Transform',
    description: 'Append each run\'s data into a persistent list across runs.',
    defaultConfig: { key: 'items' },
  },

  // ————————————————————————— Intel & Web
  {
    type: 'intel-query',
    label: 'Intel · query',
    kind: 'intel',
    group: 'Intel & Web',
    description: 'Search the knowledge graph; appends matching context to downstream input.',
    defaultConfig: { query: '{{input.message}}' },
  },
  {
    type: 'intel-write',
    label: 'Intel · write',
    kind: 'intel',
    group: 'Intel & Web',
    description: 'Write findings into the knowledge graph.',
    defaultConfig: {},
  },
  {
    type: 'tavily-search',
    label: 'Tavily search',
    kind: 'intel',
    group: 'Intel & Web',
    description: 'Web search via Tavily. Returns an array of results.',
    defaultConfig: { query: '{{input.query}}', maxResults: 5 },
  },
  {
    type: 'web-scrape',
    label: 'Web scrape',
    kind: 'intel',
    group: 'Intel & Web',
    description: 'Fetch a URL and extract its readable text content.',
    defaultConfig: { url: '' },
  },
  {
    type: 'deep-dive',
    label: 'Deep-dive research',
    kind: 'intel',
    group: 'Intel & Web',
    description: 'Multi-hop research session; kicks off, run id returned for polling.',
    defaultConfig: { topic: '' },
  },
  {
    type: 'http-request',
    label: 'HTTP request',
    kind: 'input',
    group: 'Intel & Web',
    description: 'Fetch data from an external URL (GET / POST / PUT / DELETE).',
    defaultConfig: { method: 'GET', url: '' },
  },

  // ————————————————————————— Integrations
  {
    type: 'whatsapp',
    label: 'WhatsApp · send',
    kind: 'output',
    group: 'Integrations',
    description: 'Send a message, attachment, or voice note to a WhatsApp number.',
    defaultConfig: { to: '', message: '{{input.message}}' },
  },
  {
    type: 'email',
    label: 'Email · send',
    kind: 'output',
    group: 'Integrations',
    description: 'Send an email via the configured SMTP provider.',
    defaultConfig: { to: '', subject: '', body: '{{input.body}}' },
  },
  {
    type: 'blog',
    label: 'Blog · publish',
    kind: 'output',
    group: 'Integrations',
    description: 'Publish a post to the strangeramblings blog.',
    defaultConfig: { title: '', body: '' },
  },
  {
    type: 'jkai',
    label: 'jkai · message',
    kind: 'output',
    group: 'Integrations',
    description: 'Send into a jkai conversation or notification channel.',
    defaultConfig: {},
  },
  {
    type: 'home-assistant',
    label: 'Home Assistant',
    kind: 'output',
    group: 'Integrations',
    description: 'Query or control Home Assistant entities.',
    defaultConfig: { operation: 'get_state', entityId: '' },
  },
  {
    type: 'whoop',
    label: 'Whoop',
    kind: 'output',
    group: 'Integrations',
    description: 'Pull Whoop recovery / sleep / workout data.',
    defaultConfig: { kind: 'recovery' },
  },
  {
    type: 'strava',
    label: 'Strava',
    kind: 'output',
    group: 'Integrations',
    description: 'Fetch Strava activities / stats / athlete profile.',
    defaultConfig: { kind: 'activities', limit: 10 },
  },
  {
    type: 'health-query',
    label: 'Health query',
    kind: 'output',
    group: 'Integrations',
    description: 'Natural-language query across Apple Health / Whoop / Strava.',
    defaultConfig: { query: '' },
  },
  {
    type: 'data-store',
    label: 'Data store (KV)',
    kind: 'output',
    group: 'Integrations',
    description: 'Per-workflow key-value store. Read, write, or increment.',
    defaultConfig: { operation: 'get', key: '' },
  },
  {
    type: 'inspector',
    label: 'Inspector · debug',
    kind: 'inspector',
    group: 'Integrations',
    description:
      'Runtime debug panel. Wire upstream → inspector; renders JSON, tables, CSV, HTML, images, video, audio.',
    defaultConfig: {},
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
  if (type === 'trigger') return 'trigger';
  if (type === 'chat') return 'chat';
  if (type === 'inspector') return 'inspector';
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

export { slugify } from './slug';
import { slugify as _slugify } from './slug';

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
