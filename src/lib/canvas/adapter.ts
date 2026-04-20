import { db } from '$lib/db';
import {
  workflows,
  workflowNodes,
  workflowEdges,
  workflowRuns,
  nodeExecutions,
  openrouterModels,
} from '$lib/db/schema';
import { eq, desc, asc } from 'drizzle-orm';
import { GLM_MODELS, DEFAULT_GLM_MODEL_ID } from '$lib/constants/glm-models';
import { getSetting } from '$lib/server/models/settings';

export type NodeKind = 'input' | 'llm' | 'parse' | 'output' | 'intel' | 'agent';
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

export type Canvas = {
  slug: string;
  title: string;
  workflowId: string;
  latestRunId: string | null;
  runStatus: string | null;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
};

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
  if (type === 'manual-trigger' || type === 'http-request') return 'input';
  if (type === 'llm-agent') return 'agent';
  if (type === 'llm-call' || type === 'llm-router' || type === 'openrouter' || type === 'think')
    return 'llm';
  if (type === 'text-parser' || type === 'validator') return 'parse';
  if (type === 'intel-write' || type === 'deep-dive') return 'intel';
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
const COL = [320, 540, 760, 980] as const;

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
    localId: 'trigger',
    type: 'manual-trigger',
    label: 'User message',
    x: COL[0],
    y: 120,
    config: {},
  },
  {
    localId: 'llm_primary',
    type: 'llm-call',
    label: 'glm-4-flash',
    x: COL[1],
    y: 120,
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
    x: COL[1],
    y: 240,
    config: { mode: 'json', inputField: 'response' },
  },
  {
    localId: 'llm_retry',
    type: 'llm-call',
    label: 'claude-haiku-4-5',
    x: COL[2],
    y: 240,
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
    x: COL[3],
    y: 240,
    config: {},
  },
];

const SEED_EDGES: Array<{ from: string; to: string }> = [
  { from: 'trigger', to: 'llm_primary' },
  { from: 'llm_primary', to: 'parser' },
  { from: 'parser', to: 'llm_retry' },
  { from: 'llm_retry', to: 'output' },
];

const SEED_TITLE = 'self-healing json retry';

/** Workflow name we use to key canvas slugs: "canvas:<slug>". */
function workflowNameFor(slug: string): string {
  return `canvas:${slug}`;
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

  return {
    slug,
    title,
    workflowId,
    latestRunId: latestRun?.id ?? null,
    runStatus: latestRun?.status ?? null,
    nodes: canvasNodes,
    edges: canvasEdges,
  };
}
