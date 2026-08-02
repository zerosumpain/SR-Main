import { register } from '../registry-internal';
import { db } from '$lib/db';
import {
  workflows,
  workflowNodes,
  workflowEdges,
  workflowRuns,
  workflowSchedules,
  workflowDataStore,
  nodeExecutions,
  orchestratorChats,
} from '$lib/db/schema';
import { desc, eq, asc, and, or, like, inArray, gte } from 'drizzle-orm';
import { formatTimestamp } from '../format-time';
import { slugify } from '$lib/canvas/slug';
import { registerCronJob } from '$lib/workflows/scheduler';
import { registry } from '$lib/workflows';
import { publishWorkflowUpdate } from '$lib/jkai/workflow-updates-bus';
import { findFanInCollisions, type FanInCollision } from '$lib/workflows/fan-in';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '$lib/workflows/types';
import { credentialFields } from '$lib/canvas/mutate.server';

/**
 * The recovery instruction that ships INSIDE the failure, not in a skill file.
 *
 * On 2026-07-17 one session called workflow_build_from_spec 13 times and
 * workflow_delete 14 times — the same canvas rebuilt from scratch on every
 * verification failure, with zero lints and zero repairs. The advice that would
 * have stopped it existed, in jkai-canvas/SKILL.md, inside a 2,063-character
 * line of literal `\n` escapes that no reader could parse.
 *
 * A tool result is the only prompt slot guaranteed to be read at the moment the
 * model is wrong, and it costs nothing when nothing is wrong. Anything the model
 * must do ONLY on failure belongs here rather than in the always-loaded prompt.
 */
const REPAIR_DONT_REBUILD =
  `The canvas EXISTS and every node is saved — this is a repair job, not a rebuild. ` +
  `Fix each issue above with workflow_update_node (it takes a config patch; pass null to drop a key), ` +
  `then workflow_lint to confirm they are gone. ` +
  `Do NOT call workflow_delete and build again: deleting loses the node ids, the run history and the ` +
  `canvas URL the user may already have open, and the rebuild reproduces the same guesses. ` +
  `If a single node's shape is the problem, call workflow_describe_node for its exact config schema first.`;

/**
 * The refusal every MCP node-write shares.
 *
 * The human canvas (PATCH /api/workflows/[id]/nodes/[nodeId]) has thrown
 * `SensitiveRefusalError` for a while, but the MCP tools wrote straight to the
 * table — so the actor most likely to paste a key, the LLM, was the one actor
 * with no guard. That is how a live bank client_secret reached nine tables on
 * 2026-08-01.
 *
 * Names the offending FIELDS only, never the values, and points at the tool that
 * exists precisely for this — otherwise the model does the cheap thing and asks
 * the user to paste the key into the chat.
 */
function refuseCredentialConfig(fields: string[]): { success: false; error: string } {
  return {
    success: false,
    error:
      `Refusing to write this node: config field(s) ${fields.join(', ')} look like a live credential. ` +
      `A secret in a node config spreads to the workflow row, run records, audit log and canvas history — ` +
      `deleting the node afterwards does not recall it. ` +
      `Never put a key in node config and never ask the user to paste one into the chat. ` +
      `Instead call request_credential (new secret) or update_credential (rotation), then reference the ` +
      `stored secret by its registry handle. Re-send this node with the credential field removed.`,
  };
}

/**
 * Which nodes in this workflow have upstreams that overwrite each other.
 *
 * The engine merges fan-in flat, so two branches emitting the same keys silently
 * lose one of them. That is invisible until a run fails somewhere else entirely
 * (see $lib/workflows/fan-in), so it is surfaced on every structural read and on
 * every edge that creates one.
 */
async function fanInWarnings(workflowId: string): Promise<FanInCollision[]> {
  const [nodes, edges] = await Promise.all([
    db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, workflowId)),
    db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, workflowId)),
  ]);
  return findFanInCollisions(
    nodes as unknown as WorkflowNodeDef[],
    edges as unknown as WorkflowEdgeDef[],
    (type, config) => registry.getExecutor(type)?.getOutputSchema(config),
  );
}

/**
 * Coerce the generator's `workflow.trigger` (set by the orchestrator's
 * set_trigger tool) into the three shapes we need:
 *   - the `workflows.trigger` JSON column
 *   - the trigger node's `config` JSON
 *   - the `workflowSchedules` row (only for kind=cron / kind=event)
 *
 * The orchestrator emits config.expression for cron (per its tool description
 * — "provide config.expression as a cron string"); we also accept config.cron
 * defensively in case the model wrote that key by mistake.
 */
function deriveTriggerShape(trigger: { type: string; config?: Record<string, unknown> } | undefined) {
  const type = trigger?.type ?? 'manual';
  const cfg = (trigger?.config ?? {}) as Record<string, unknown>;
  if (type === 'cron') {
    const expression =
      (typeof cfg.expression === 'string' && cfg.expression) ||
      (typeof cfg.cron === 'string' && cfg.cron) ||
      '';
    return {
      workflowsTrigger: { type: 'cron', config: { expression } },
      nodeConfig: { kind: 'cron', cron: expression },
      scheduleRow: expression
        ? { type: 'cron' as const, config: { expression } }
        : null,
    };
  }
  if (type === 'webhook') {
    // D4 — a generator-authored webhook may include an optional shared secret
    // (`trigger.config.secret`). Hoist a validated string to the canonical
    // top-level `workflows.trigger.secret` (matching the trigger PUT route),
    // and mirror it onto the trigger node config so the canvas can read it back.
    const secret = typeof cfg.secret === 'string' ? cfg.secret.trim() : '';
    const workflowsTrigger: Record<string, unknown> = { type: 'webhook', config: cfg };
    if (secret) workflowsTrigger.secret = secret;
    const nodeConfig: Record<string, unknown> = { kind: 'webhook', ...cfg };
    if (secret) nodeConfig.secret = secret;
    return {
      workflowsTrigger,
      nodeConfig,
      scheduleRow: null,
    };
  }
  if (type === 'event') {
    const eventType = typeof cfg.eventType === 'string' ? cfg.eventType : '';
    const sourceWorkflowId = typeof cfg.sourceWorkflowId === 'string' ? cfg.sourceWorkflowId : undefined;
    return {
      workflowsTrigger: { type: 'event', config: cfg },
      nodeConfig: { kind: 'event', eventType, ...(sourceWorkflowId ? { sourceWorkflowId } : {}) },
      scheduleRow: eventType
        ? { type: 'event' as const, config: sourceWorkflowId ? { eventType, sourceWorkflowId } : { eventType } }
        : null,
    };
  }
  // manual (default)
  return {
    workflowsTrigger: { type: 'manual' },
    nodeConfig: { kind: 'manual' },
    scheduleRow: null,
  };
}

type SummaryNode = { id: string; type: string; label: string; config: Record<string, unknown> };
type SummaryEdge = { sourceNodeId: string; targetNodeId: string };
type SummaryIssue = { nodeId: string; nodeLabel: string; field: string; issue: string; severity: 'error' | 'warning' };

/**
 * Render a single config value for inline display in chat. Trims strings to
 * 80 chars (keeps the markdown bullet readable on phones), stringifies objects/
 * arrays, and represents undefined/empty as `<unset>` so the user can see what's
 * missing without having to open the canvas.
 */
function formatConfigValue(v: unknown): string {
  if (v == null || v === '') return '<unset>';
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 77) + '…' : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = JSON.stringify(v);
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
}

function formatNodeConfigInline(cfg: Record<string, unknown>): string {
  const entries = Object.entries(cfg ?? {});
  if (entries.length === 0) return '_no config_';
  return entries
    .map(([k, v]) => `\`${k}=${formatConfigValue(v)}\``)
    .join(', ');
}

/**
 * Trace edges from any root (a node with no incoming edge) and produce a
 * compact "A → B → C" string. Falls through to a comma list if the graph
 * doesn't reduce to chains.
 */
function buildFlowDiagram(nodes: SummaryNode[], edges: SummaryEdge[]): string {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const inDeg = new Map<string, number>();
  for (const n of nodes) inDeg.set(n.id, 0);
  for (const e of edges) inDeg.set(e.targetNodeId, (inDeg.get(e.targetNodeId) ?? 0) + 1);
  const roots = nodes.filter(n => (inDeg.get(n.id) ?? 0) === 0);
  if (roots.length === 0) return nodes.map(n => n.label).join(', ');
  const chains: string[] = [];
  for (const root of roots) {
    const chain: string[] = [];
    let cur: SummaryNode | undefined = root;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.push(cur.label);
      const next = edges.find(e => e.sourceNodeId === cur!.id);
      cur = next ? byId.get(next.targetNodeId) : undefined;
    }
    chains.push(chain.join(' → '));
  }
  return chains.join('  \n');
}

function buildWorkflowSummaryMarkdown(opts: {
  linkLabel: string;
  url: string;
  description?: string;
  nodes: SummaryNode[];
  edges: SummaryEdge[];
  issues: SummaryIssue[];
}): string {
  const { linkLabel, url, description, nodes, edges, issues } = opts;
  const out: string[] = [];
  out.push(`**[${linkLabel}](${url})** — ${nodes.length} ${nodes.length === 1 ? 'node' : 'nodes'}`);
  if (description) {
    out.push('');
    out.push(`> ${description.replace(/\n/g, ' ').trim()}`);
  }
  out.push('');
  out.push('**Nodes**');
  nodes.forEach((n, i) => {
    out.push(`${i + 1}. \`${n.type}\` **${n.label}** — ${formatNodeConfigInline(n.config)}`);
  });
  out.push('');
  out.push('**Flow** ' + buildFlowDiagram(nodes, edges));
  if (issues.length > 0) {
    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');
    out.push('');
    out.push('> ⚠ **Needs attention on the canvas**');
    for (const i of errors) {
      out.push(`> - **${i.nodeLabel}** · \`${i.field}\` — ${i.issue}`);
    }
    for (const i of warnings) {
      out.push(`> - ${i.nodeLabel} · \`${i.field}\` — ${i.issue} _(warning)_`);
    }
  }
  return out.join('\n');
}

// ==========================================
// Existing Tools (moved)
// ==========================================

// ==========================================
// workflow_build_from_spec — deterministic JSON-driven canvas builder.
// Replaces the legacy workflow_create autonomous-LLM-loop generator.
// You design the workflow in chat, then call this tool with an explicit spec.
// ==========================================

type SpecNode = {
  /** Stable id you reference from edges. Maps internally to a UUID. */
  id: string;
  /** Registered node type (e.g. 'http-request', 'whatsapp', 'home-assistant'). */
  type: string;
  /** Human label shown on the canvas. */
  label: string;
  /** Node config — the actual saved JSON. Must match the node type's schema. */
  config?: Record<string, unknown>;
  /** Optional canvas position. Defaults to an auto-laid grid. */
  position?: { x: number; y: number };
};
type SpecEdge = {
  /** Source node id (matches SpecNode.id). */
  from: string;
  /** Target node id. */
  to: string;
  /** Optional source handle (e.g. 'true' / 'false' on conditional nodes). */
  sourceHandle?: string | null;
  /** Optional target handle. */
  targetHandle?: string | null;
};

function validateSpec(args: Record<string, unknown>): {
  ok: true;
  spec: {
    name: string;
    description?: string;
    trigger: { type: 'manual' | 'cron' | 'webhook' | 'event'; config?: Record<string, unknown> };
    nodes: SpecNode[];
    edges: SpecEdge[];
    attachChatNode: boolean;
  };
} | { ok: false; error: string } {
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  if (!name) return { ok: false, error: '`name` (string) is required.' };
  const description = typeof args.description === 'string' ? args.description : undefined;
  const trigArg = args.trigger as { type?: unknown; config?: unknown } | undefined;
  const tType = typeof trigArg?.type === 'string' ? trigArg.type : 'manual';
  if (!['manual', 'cron', 'webhook', 'event'].includes(tType)) {
    return { ok: false, error: `\`trigger.type\` must be one of manual|cron|webhook|event (got "${tType}").` };
  }
  const trigger = {
    type: tType as 'manual' | 'cron' | 'webhook' | 'event',
    config: (trigArg?.config && typeof trigArg.config === 'object' ? trigArg.config : {}) as Record<string, unknown>,
  };
  if (trigger.type === 'cron') {
    const cfg = trigger.config;
    const expr = typeof cfg.expression === 'string' ? cfg.expression : (typeof cfg.cron === 'string' ? cfg.cron : '');
    if (!expr) return { ok: false, error: '`trigger.config.expression` (cron string, e.g. "*/15 * * * *") is required when trigger.type=cron.' };
  }
  const nodesArg = Array.isArray(args.nodes) ? args.nodes : null;
  if (!nodesArg || nodesArg.length === 0) {
    return { ok: false, error: '`nodes` (non-empty array) is required.' };
  }
  const seenIds = new Set<string>();
  const nodes: SpecNode[] = [];
  for (let i = 0; i < nodesArg.length; i++) {
    const n = nodesArg[i] as Record<string, unknown>;
    if (!n || typeof n !== 'object') return { ok: false, error: `nodes[${i}] must be an object.` };
    const id = typeof n.id === 'string' ? n.id.trim() : '';
    if (!id) return { ok: false, error: `nodes[${i}].id (string) is required.` };
    if (seenIds.has(id)) return { ok: false, error: `nodes[${i}].id "${id}" duplicated.` };
    seenIds.add(id);
    const type = typeof n.type === 'string' ? n.type.trim() : '';
    if (!type) return { ok: false, error: `nodes[${i}].type (string) is required.` };
    if (!registry.getDefinition(type)) {
      return { ok: false, error: `nodes[${i}].type "${type}" is not a registered node type. Use workflow_search_nodes / workflow_list_node_types to find valid types.` };
    }
    const label = typeof n.label === 'string' && n.label.trim() ? n.label.trim() : type;
    const config = (n.config && typeof n.config === 'object' ? n.config : {}) as Record<string, unknown>;
    const position = (n.position && typeof n.position === 'object'
      && typeof (n.position as { x?: unknown }).x === 'number'
      && typeof (n.position as { y?: unknown }).y === 'number')
      ? { x: (n.position as { x: number }).x, y: (n.position as { y: number }).y }
      : undefined;
    nodes.push({ id, type, label, config, position });
  }
  const edgesArg = Array.isArray(args.edges) ? args.edges : [];
  const edges: SpecEdge[] = [];
  for (let i = 0; i < edgesArg.length; i++) {
    const e = edgesArg[i] as Record<string, unknown>;
    if (!e || typeof e !== 'object') return { ok: false, error: `edges[${i}] must be an object.` };
    const from = typeof e.from === 'string' ? e.from.trim() : (typeof e.source === 'string' ? e.source.trim() : '');
    const to = typeof e.to === 'string' ? e.to.trim() : (typeof e.target === 'string' ? e.target.trim() : '');
    if (!from || !to) return { ok: false, error: `edges[${i}] requires \`from\` and \`to\` (spec node ids).` };
    if (!seenIds.has(from) && from !== 'trigger') return { ok: false, error: `edges[${i}].from "${from}" does not match any spec node id.` };
    if (!seenIds.has(to)) return { ok: false, error: `edges[${i}].to "${to}" does not match any spec node id.` };
    edges.push({
      from,
      to,
      sourceHandle: typeof e.sourceHandle === 'string' ? e.sourceHandle : null,
      targetHandle: typeof e.targetHandle === 'string' ? e.targetHandle : null,
    });
  }
  const attachChatNode = args.attach_chat_node === undefined ? true : Boolean(args.attach_chat_node);
  return { ok: true, spec: { name, description, trigger, nodes, edges, attachChatNode } };
}

function shortSlug(src: string): string {
  const base = slugify(src || 'canvas');
  if (!base) return 'canvas';
  if (base.length <= 24) return base;
  const words = base.split('-');
  let out = '';
  for (const w of words) {
    const next = out ? `${out}-${w}` : w;
    if (next.length > 24) break;
    out = next;
  }
  return out || base.slice(0, 24);
}

async function pickUniqueSlug(seed: string): Promise<string> {
  const baseSlug = shortSlug(seed);
  let slug = baseSlug;
  let attempt = 1;
  while (attempt < 50) {
    const [existing] = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(eq(workflows.name, `canvas:${slug}`));
    if (!existing) break;
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }
  return slug;
}

register({
  name: 'workflow_build_from_spec',
  description:
    'Build a NEW canvas (workflow) from an EXPLICIT JSON spec — name, trigger, nodes, edges. ' +
    'PREFER workflow_generate UNLESS the user dictated exact node types and config: this tool takes your spec verbatim, ' +
    'so every config shape is a guess you are making, whereas workflow_generate grounds itself in the live node registry, ' +
    'plans, runs a critic round, then verifies and self-heals before saving. Reach for this one when you need precise ' +
    'control over an exact DAG the user specified. ' +
    'Use this when the user has confirmed the design you proposed in chat. ' +
    'DESIGN-FIRST WORKFLOW: Before calling this tool, you MUST have written out the design ' +
    'in chat (numbered nodes with type+label+config, edge wiring) and the user must have ' +
    'said yes/build it/ship it. Never call this tool with a guess at the design — every ' +
    'config field must be intentional. ' +
    'Each node is inserted into the canvas one at a time with a small delay, and the ' +
    'canvas page auto-refreshes between inserts so the user can watch the build live if ' +
    'they have the URL open. ' +
    'The tool emits the canvas URL on its very first progress event so the user can open it ' +
    'before the build finishes. ' +
    'CRITICAL: paste `data.summaryMarkdown` VERBATIM as your reply when the tool returns. ' +
    'It contains the canvas link, the description, every node with its actual saved config, ' +
    'the flow diagram, and any "Needs attention" issues that need fixing on the canvas. ' +
    'Do NOT rewrite it, summarise it, or construct your own URL.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Short canvas name (will be slugified for the URL).',
      },
      description: {
        type: 'string',
        description: 'One-line human description of what the canvas does.',
      },
      trigger: {
        type: 'object',
        description:
          'How the workflow fires. type ∈ {manual, cron, webhook, event}. For cron, set config.expression to a 5-field cron string (e.g. "*/15 * * * *"). For event, set config.eventType. For webhook, optionally set config.secret to a shared secret — callers must then send it as the X-Webhook-Secret header or the POST is rejected with 401.',
        properties: {
          type: { type: 'string' },
          config: { type: 'object' },
        },
      },
      nodes: {
        type: 'array',
        description:
          'The non-trigger nodes that do the work. Each node: { id (spec-local, used by edges), type (registered node type), label, config, position? }. The trigger node is auto-inserted — do NOT include a node with type="trigger" yourself.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string' },
            label: { type: 'string' },
            config: { type: 'object' },
            position: { type: 'object' },
          },
        },
      },
      edges: {
        type: 'array',
        description:
          'Wiring between nodes. Each edge: { from (spec id), to (spec id), sourceHandle? (e.g. "true"/"false" on conditional), targetHandle? }. Use "trigger" as a special source id to wire from the auto-inserted trigger node; if you omit a trigger edge, one is added to the first non-chat node automatically.',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
            sourceHandle: { type: 'string' },
            targetHandle: { type: 'string' },
          },
        },
      },
      attach_chat_node: {
        type: 'boolean',
        description:
          'When true (default), inserts a `chat` node alongside the trigger so the user can continue talking to you from the canvas. Set false only if the workflow really has no chat interaction.',
      },
    },
    required: ['name', 'nodes'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args, ctx) => {
    const emit = ctx?.emit ?? (() => {});

    // Refuse when called from a canvas chat — the user is on an existing
    // canvas and wants nodes added to *that* canvas, not a brand-new one.
    // The MCP layer threads the inbound chat_id as `conversationId`; for
    // canvas_chat sessions Hermes sets chat_id = the canvas's workflow_id
    // (a UUID), so a UUID-shaped conversationId is the "we're on a canvas"
    // signal. jkai-general sessions get synthetic non-UUID ids.
    if (ctx?.conversationId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ctx.conversationId)) {
      return {
        success: false,
        error:
          `workflow_build_from_spec creates a NEW canvas — but this chat is already on workflow ${ctx.conversationId}. ` +
          `To add nodes to the current canvas, use workflow_add_node + workflow_add_edge (per the design-first flow). ` +
          `Only call workflow_build_from_spec from the general /jkai chat hub (which has no workflow scope).`,
      };
    }

    const v = validateSpec(args);
    if (!v.ok) return { success: false, error: v.error };
    const spec = v.spec;

    // Scan the WHOLE spec before the canvas row exists — refusing halfway would
    // leave a half-built canvas holding the secret it was refused over.
    const specOffenders = [
      ...new Set(spec.nodes.flatMap((n) => credentialFields(n.config ?? {}))),
    ];
    if (specOffenders.length > 0) return refuseCredentialConfig(specOffenders);

    // Slug + canvas URL up-front. Emit before any DB work so the user can
    // open the canvas before the first node lands.
    const slug = await pickUniqueSlug(spec.name);
    const baseUrl = (process.env.PUBLIC_SITE_URL || 'https://strangeramblings.com').replace(/\/+$/, '');
    const url = `${baseUrl}/jkai/canvas/${slug}`;
    emit(`Building canvas — [${spec.name}](${url}). Open the link to watch it grow.`);

    const triggerShape = deriveTriggerShape(spec.trigger);

    // Pre-compute deterministic UUIDs for every spec node id so edges can
    // reference them before the nodes are inserted.
    const idMap = new Map<string, string>();
    for (const n of spec.nodes) idMap.set(n.id, crypto.randomUUID());
    const triggerNodeId = crypto.randomUUID();
    idMap.set('trigger', triggerNodeId);
    let chatNodeId: string | null = null;
    if (spec.attachChatNode && !spec.nodes.some(n => n.type === 'chat')) {
      chatNodeId = crypto.randomUUID();
    }

    // Insert workflow row + trigger node atomically so the canvas page can
    // load the moment it sees the URL. Subsequent nodes/edges then stream
    // in via incremental inserts.
    let workflowId: string;
    try {
      workflowId = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(workflows)
          .values({
            name: `canvas:${slug}`,
            description: spec.description || spec.name,
            trigger: triggerShape.workflowsTrigger,
          })
          .returning({ id: workflows.id });
        await tx.insert(workflowNodes).values({
          id: triggerNodeId,
          workflowId: row.id,
          type: 'trigger',
          position: { x: 20, y: 20 },
          config: triggerShape.nodeConfig,
          label: spec.trigger.type === 'cron' ? `Trigger (${spec.trigger.config?.expression ?? 'cron'})` : 'Trigger',
        });
        if (chatNodeId) {
          // Conversation handoff: pin the originating /jkai conversation onto
          // the chat node so the canvas adapter pulls those orchestrator_chats
          // rows alongside the workflow-tagged ones. The user opens the
          // canvas URL and sees the same conversation continuing inside the
          // chat node — same wiring `pinConversationToCanvasChat` uses for
          // `?conv=` deep-links from /jkai.
          //
          // Hermes' chat_id has the form `chat_<uuid>`; orchestrator_chats
          // stores the bare uuid as conversation_id. Strip the prefix.
          const conversationId = ctx?.conversationId?.startsWith('chat_')
            ? ctx.conversationId.slice('chat_'.length)
            : ctx?.conversationId;
          await tx.insert(workflowNodes).values({
            id: chatNodeId,
            workflowId: row.id,
            type: 'chat',
            position: { x: 20, y: 200 },
            config: conversationId ? { conversationId } : {},
            label: 'Chat',
          });
        }
        return row.id;
      });
    } catch (dbErr: unknown) {
      const msg = dbErr instanceof Error ? dbErr.message : 'Unknown DB error';
      return { success: false, error: `Failed to create canvas row: ${msg}` };
    }

    publishWorkflowUpdate({ workflowId, kind: 'build_started', summary: 'Canvas ready — building nodes', ts: Date.now() });
    publishWorkflowUpdate({ workflowId, kind: 'node_added', nodeId: triggerNodeId, summary: 'Trigger', ts: Date.now() });
    if (chatNodeId) {
      publishWorkflowUpdate({ workflowId, kind: 'node_added', nodeId: chatNodeId, summary: 'Chat', ts: Date.now() });
    }

    // Incrementally insert spec nodes — separate small transaction per node,
    // 200ms gap between each, plus a workflow-update event so the canvas
    // re-fetches and animates the node appearing.
    const insertedNodeIds: string[] = [triggerNodeId];
    if (chatNodeId) insertedNodeIds.push(chatNodeId);
    for (let i = 0; i < spec.nodes.length; i++) {
      const n = spec.nodes[i];
      const nodeUuid = idMap.get(n.id)!;
      // Auto-layout: fallback grid below the trigger if no position given.
      const position = n.position ?? { x: 240 + (i % 3) * 280, y: 20 + Math.floor(i / 3) * 160 };
      try {
        await db.insert(workflowNodes).values({
          id: nodeUuid,
          workflowId,
          type: n.type,
          position,
          config: n.config,
          label: n.label,
        });
        insertedNodeIds.push(nodeUuid);
        emit(`Added node: ${n.label} (${n.type})`);
        publishWorkflowUpdate({ workflowId, kind: 'node_added', nodeId: nodeUuid, summary: n.label, ts: Date.now() });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        emit(`Skipped node "${n.label}" (${n.type}): ${msg}`);
      }
      // Give the canvas time to re-fetch and render between inserts. 200ms
      // is fast enough to feel responsive on a 5-node build (~1s) without
      // making 30-node builds drag.
      await new Promise(r => setTimeout(r, 200));
    }

    // Edges. Resolve spec ids to UUIDs and skip any that point at a node
    // that failed to insert. Auto-wire trigger → first non-chat node if the
    // model didn't specify a trigger edge.
    const resolvedEdges: { id: string; sourceNodeId: string; targetNodeId: string; sourceHandle: string | null; targetHandle: string | null }[] = [];
    const triggerHasOutgoing = spec.edges.some(e => e.from === 'trigger');
    if (!triggerHasOutgoing) {
      // First non-chat spec node that actually got inserted
      const firstReal = spec.nodes.find(n => insertedNodeIds.includes(idMap.get(n.id)!) && n.type !== 'chat');
      if (firstReal) {
        resolvedEdges.push({
          id: crypto.randomUUID(),
          sourceNodeId: triggerNodeId,
          targetNodeId: idMap.get(firstReal.id)!,
          sourceHandle: null,
          targetHandle: null,
        });
      }
    }
    for (const e of spec.edges) {
      const sourceNodeId = idMap.get(e.from);
      const targetNodeId = idMap.get(e.to);
      if (!sourceNodeId || !targetNodeId) continue;
      if (!insertedNodeIds.includes(sourceNodeId) || !insertedNodeIds.includes(targetNodeId)) continue;
      resolvedEdges.push({
        id: crypto.randomUUID(),
        sourceNodeId,
        targetNodeId,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
      });
    }
    for (const edge of resolvedEdges) {
      try {
        await db.insert(workflowEdges).values({
          id: edge.id,
          workflowId,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        });
        publishWorkflowUpdate({ workflowId, kind: 'edge_added', edgeId: edge.id, ts: Date.now() });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        emit(`Edge insert failed: ${msg}`);
      }
      await new Promise(r => setTimeout(r, 100));
    }

    // Schedule + cron registration for cron/event triggers.
    if (triggerShape.scheduleRow) {
      try {
        const [sch] = await db
          .insert(workflowSchedules)
          .values({
            workflowId,
            type: triggerShape.scheduleRow.type,
            config: triggerShape.scheduleRow.config,
            enabled: true,
          })
          .returning();
        if (triggerShape.scheduleRow.type === 'cron') {
          registerCronJob({ id: sch.id, workflowId, config: sch.config });
        }
        emit('Schedule registered.');
      } catch (schedErr: unknown) {
        const msg = schedErr instanceof Error ? schedErr.message : String(schedErr);
        console.error('[workflow_build_from_spec] schedule setup failed', msg);
        emit(`Schedule setup failed: ${msg} — fix on canvas.`);
      }
    }

    publishWorkflowUpdate({ workflowId, kind: 'build_complete', summary: 'Build complete', ts: Date.now() });

    // Final verification + summaryMarkdown. Re-read the persisted state so
    // what we show matches what got saved (not what the spec said — the spec
    // might have failed an insert here or there).
    const persistedNodes = await db
      .select()
      .from(workflowNodes)
      .where(eq(workflowNodes.workflowId, workflowId));
    const persistedEdges = await db
      .select()
      .from(workflowEdges)
      .where(eq(workflowEdges.workflowId, workflowId));
    const { runWorkflowVerification } = await import('$lib/workflows/orchestrator');
    const issues = runWorkflowVerification(
      persistedNodes.map(n => ({
        id: n.id,
        type: n.type,
        label: n.label ?? '',
        config: (n.config ?? {}) as Record<string, unknown>,
        position: (n.position ?? { x: 0, y: 0 }) as { x: number; y: number },
      })),
      persistedEdges.map(e => ({
        id: e.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
      })),
    ) as SummaryIssue[];

    const summaryNodes: SummaryNode[] = persistedNodes.map(n => ({
      id: n.id,
      type: n.type,
      label: n.label ?? n.type,
      config: (n.config ?? {}) as Record<string, unknown>,
    }));
    const summaryEdges: SummaryEdge[] = persistedEdges.map(e => ({
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
    }));
    const summaryMarkdown = buildWorkflowSummaryMarkdown({
      linkLabel: spec.name,
      url,
      description: spec.description,
      nodes: summaryNodes,
      edges: summaryEdges,
      issues,
    });

    // BLOCKING verification (#5). Errors are no longer advisory text inside a
    // success response — when verification finds error-severity issues, the
    // canvas was still persisted (so the user can open it), but the tool
    // result reports `success:false` with the structured issues so the agent
    // MUST resolve them (via workflow_update_node / workflow_add_edge) before
    // declaring the workflow done. Warnings stay advisory.
    //
    // Backward-compat: every field the old success payload carried is still
    // present in `data` (workflowId, slug, url, summaryMarkdown, …) plus the
    // structured `verificationIssues`, so existing callers that read those keep
    // working. We add `status` + `formattedIssues` for the blocking path.
    const errorIssues = issues.filter((i) => i.severity === 'error');
    const { formatIssues } = await import('$lib/workflows/orchestrator/verify');
    const data = {
      workflowId,
      slug,
      name: spec.name,
      description: spec.description,
      nodeCount: persistedNodes.length,
      url,
      summaryMarkdown,
      linkMarkdown: `[${spec.name}](${url})`,
      verificationIssues: issues,
      verificationPassed: errorIssues.length === 0,
      status: errorIssues.length === 0 ? 'built' : 'needs_fix',
    };

    if (errorIssues.length > 0) {
      return {
        success: false,
        error:
          `Workflow "${spec.name}" was created at ${url} but verification found ${errorIssues.length} blocking error(s) — fix them before telling the user it's done:\n\n` +
          formatIssues(errorIssues) +
          `\n\n${REPAIR_DONT_REBUILD}`,
        data,
      };
    }

    return {
      success: true,
      data,
    };
  },
});


register({
  name: 'workflow_list',
  description: 'List existing workflows with their names, descriptions, and schedule status',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async () => {
    const rows = await db.select().from(workflows).orderBy(desc(workflows.createdAt)).limit(50);
    return { success: true, data: rows };
  },
});

register({
  name: 'workflow_delete',
  destructive: true,
  description:
    'Permanently delete a workflow by ID. This CASCADES — all nodes, edges, run history, chat messages and audit log for the canvas are wiped and CANNOT be recovered. ' +
    'Only call this when the user has explicitly asked to delete that specific workflow by name or id. ' +
    'You MUST pass confirmName matching the workflow\'s exact current name so the user cannot be wiped out by a misinterpreted request. ' +
    'If you are on a canvas and the user asks to "start over" or "clear", DO NOT delete — use workflow_remove_node / workflow_remove_edge instead.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Workflow ID to delete' },
      confirmName: {
        type: 'string',
        description: 'Must exactly match the workflow\'s current `name` (e.g. "canvas:scraptest"). Safety check — call workflow_inspect first to read the name.',
      },
    },
    required: ['id', 'confirmName'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const id = args.id as string;
    const confirmName = args.confirmName as string;
    const [existing] = await db.select().from(workflows).where(eq(workflows.id, id)).limit(1);
    if (!existing) return { success: false, error: 'Workflow not found' };
    if (existing.name !== confirmName) {
      return {
        success: false,
        error: `Refusing to delete: confirmName "${confirmName}" does not match workflow name "${existing.name}". Call workflow_inspect to read the exact name, confirm with the user, and retry.`,
      };
    }
    await db.delete(workflows).where(eq(workflows.id, id));
    return { success: true, data: { deleted: true, name: existing.name } };
  },
});

// ==========================================
// Inspection Tools
// ==========================================

register({
  name: 'workflow_inspect',
  description: 'Full structural view of a workflow — metadata, all nodes (type, label, config), all edges (connections), schedules, and last 5 execution runs',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Workflow ID' } },
    required: ['id'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const id = args.id as string;
    const [wf] = await db.select().from(workflows).where(eq(workflows.id, id)).limit(1);
    if (!wf) return { success: false, error: 'Workflow not found' };

    const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, id));
    const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, id));
    const schedules = await db.select().from(workflowSchedules).where(eq(workflowSchedules.workflowId, id));
    const recentRuns = await db
      .select({
        id: workflowRuns.id,
        status: workflowRuns.status,
        trigger: workflowRuns.trigger,
        startedAt: workflowRuns.startedAt,
        completedAt: workflowRuns.completedAt,
        error: workflowRuns.error,
      })
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, id))
      .orderBy(desc(workflowRuns.startedAt))
      .limit(5);

    const fanIn = findFanInCollisions(
      nodes as unknown as WorkflowNodeDef[],
      edges as unknown as WorkflowEdgeDef[],
      (type, config) => registry.getExecutor(type)?.getOutputSchema(config),
    );

    return {
      success: true,
      data: {
        ...wf,
        nodes,
        edges,
        // Present only when there is something wrong, so a clean canvas reads clean.
        ...(fanIn.length ? { fanInWarnings: fanIn.map((c) => c.message) } : {}),
        schedules: schedules.map((s) => ({
          ...s,
          lastRunAtFormatted: formatTimestamp(s.lastRunAt),
          nextRunAtFormatted: formatTimestamp(s.nextRunAt),
        })),
        recentRuns: recentRuns.map((r) => ({
          ...r,
          startedAtFormatted: formatTimestamp(r.startedAt),
          completedAtFormatted: formatTimestamp(r.completedAt),
        })),
        url: `https://strangeramblings.com/jkai/canvas/${
          wf.name.startsWith('canvas:') ? wf.name.slice('canvas:'.length) : id
        }`,
      },
    };
  },
});

register({
  name: 'workflow_get_run',
  description: 'Drill into a specific workflow execution run — per-node inputs, outputs, errors, timing, and logs',
  parameters: {
    type: 'object',
    properties: { runId: { type: 'string', description: 'Run ID (from workflow_inspect recentRuns)' } },
    required: ['runId'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const runId = args.runId as string;
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId)).limit(1);
    if (!run) return { success: false, error: 'Run not found' };

    const executions = await db
      .select()
      .from(nodeExecutions)
      .where(eq(nodeExecutions.runId, runId))
      .orderBy(asc(nodeExecutions.startedAt));

    // Enrich with node labels
    const nodeIds = executions.map((e) => e.nodeId);
    const nodeMap = new Map<string, string>();
    if (nodeIds.length > 0) {
      const nodeRows = await db
        .select({ id: workflowNodes.id, label: workflowNodes.label })
        .from(workflowNodes)
        .where(or(...nodeIds.map((nid) => eq(workflowNodes.id, nid))));
      for (const n of nodeRows) nodeMap.set(n.id, n.label);
    }

    return {
      success: true,
      data: {
        ...run,
        nodeExecutions: executions.map((e) => ({
          ...e,
          nodeLabel: nodeMap.get(e.nodeId) || e.nodeId,
        })),
      },
    };
  },
});

register({
  name: 'workflow_get_generation_log',
  description: 'Replay how the orchestrator built a workflow — the tool-calling sequence (search_nodes, use_node, connect_nodes, finalize) with reasoning',
  parameters: {
    type: 'object',
    properties: { workflowId: { type: 'string', description: 'Workflow ID' } },
    required: ['workflowId'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const rows = await db
      .select()
      .from(orchestratorChats)
      .where(eq(orchestratorChats.workflowId, args.workflowId as string))
      .orderBy(asc(orchestratorChats.createdAt));

    if (rows.length === 0) return { success: false, error: 'No generation log found — this workflow may have been created manually or the log was not retained' };
    return { success: true, data: rows };
  },
});

// ==========================================
// Update Tools — Metadata
// ==========================================

register({
  name: 'workflow_update_metadata',
  description: 'Rename a workflow, update its description, or change its trigger config',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Workflow ID' },
      name: { type: 'string', description: 'New name' },
      description: { type: 'string', description: 'New description' },
      trigger: { type: 'object', description: 'New trigger config (e.g. {"type":"manual"})' },
    },
    required: ['id'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (args.name) updates.name = args.name;
    if (args.description !== undefined) updates.description = args.description;
    if (args.trigger) updates.trigger = args.trigger;
    const [wf] = await db.update(workflows).set(updates).where(eq(workflows.id, args.id as string)).returning();
    return wf ? { success: true, data: wf } : { success: false, error: 'Workflow not found' };
  },
});

// ==========================================
// Update Tools — Nodes
// ==========================================

// Validate a node type string against the registry. Returns null if valid, or
// an error message listing the valid types if not. Lazy-imports to avoid any
// circular init between site-tools and the workflow registry.
async function validateNodeType(type: string): Promise<string | null> {
  const { registry } = await import('$lib/workflows');
  if (registry.getDefinition(type)) return null;
  const valid = registry.listDefinitions().map((d) => d.type).sort();
  return `Unknown node type "${type}". Valid types: ${valid.join(', ')}. If you need a new integration, use create_node via workflow_create instead of inventing a type name.`;
}

/** Validate config against a node's configSchema + semantic rules. Returns null if OK, or an error string. */
async function validateNodeConfig(type: string, config: Record<string, unknown>): Promise<string | null> {
  const { registry } = await import('$lib/workflows');
  const def = registry.getDefinition(type);
  // Defer to the shared validator from the orchestrator — same checks on both
  // entry points (unknown keys, unsupported templates, code-execute typos,
  // per-operation semantic gaps).
  const { validateNodeConfigPreSubmit } = await import('$lib/workflows/orchestrator/verify');
  const err = validateNodeConfigPreSubmit(type, config, def);
  if (err) return err;
  const missingRequired = (def?.configSchema?.required || []).filter((k: string) => !(k in config));
  if (missingRequired.length > 0) {
    return `Missing required config keys for "${type}": ${missingRequired.join(', ')}`;
  }
  return null;
}

register({
  name: 'workflow_update_node',
  description:
    "Update a workflow node's config, label, or type. When changing type, the new type must exist in the node registry. " +
    'To REMOVE a config key entirely (not just set it to a new value), either pass it as `null` in `config` or list its name in `removeConfigKeys`. ' +
    'Setting a key to `null` and leaving the key in the saved config used to be an LLM trap — now both paths actually delete.',
  parameters: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Node ID' },
      config: {
        type: 'object',
        description:
          'Patch merged into existing config. To remove a key, set it to null (e.g. `{ value: null }`) — the merged result drops the key entirely.',
      },
      removeConfigKeys: {
        type: 'array',
        items: { type: 'string' },
        description: 'Explicit list of config keys to delete after the merge. Use this when you want to be unambiguous about removal.',
      },
      label: { type: 'string', description: 'New label' },
      type: { type: 'string', description: 'New node type — must match a registered type (e.g. "whatsapp", "llm-call", "code-execute"). Use workflow_list_node_types to see all valid types.' },
    },
    required: ['nodeId'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const nodeId = args.nodeId as string;
    const [existing] = await db.select().from(workflowNodes).where(eq(workflowNodes.id, nodeId)).limit(1);
    if (!existing) return { success: false, error: 'Node not found' };

    if (args.type) {
      const err = await validateNodeType(args.type as string);
      if (err) return { success: false, error: err };
    }

    const updates: Record<string, unknown> = {};
    if (args.label) updates.label = args.label;
    if (args.type) updates.type = args.type;

    const incomingConfig = (args.config as Record<string, unknown> | undefined) ?? null;
    const removeKeys = Array.isArray(args.removeConfigKeys)
      ? (args.removeConfigKeys as string[])
      : [];
    if (incomingConfig || removeKeys.length > 0) {
      const merged: Record<string, unknown> = {
        ...(existing.config as Record<string, unknown>),
        ...(incomingConfig ?? {}),
      };
      // Treat null as "delete this key" — most LLM-friendly way to remove a
      // stale config field. Without this, `{ value: null }` left a `null`
      // sentinel in the saved config and the lint kept flagging it.
      if (incomingConfig) {
        for (const k of Object.keys(incomingConfig)) {
          if (incomingConfig[k] === null) delete merged[k];
        }
      }
      for (const k of removeKeys) delete merged[k];
      const offending = credentialFields(merged);
      if (offending.length > 0) return refuseCredentialConfig(offending);
      updates.config = merged;
    }

    const [node] = await db.update(workflowNodes).set(updates).where(eq(workflowNodes.id, nodeId)).returning();
    if (node) {
      publishWorkflowUpdate({
        workflowId: node.workflowId,
        kind: 'node_updated',
        nodeId: node.id,
        summary: node.label,
        node: {
          id: node.id,
          type: node.type,
          label: node.label,
          config: node.config,
          position: node.position,
        },
        ts: Date.now(),
      });
    }
    return { success: true, data: node };
  },
});

register({
  name: 'workflow_add_node',
  description: 'Add a new node to a workflow. The type must match a registered node type exactly — typos (e.g. "code-exec" instead of "code-execute", or "whatsapp-message" instead of "whatsapp") will be rejected because the canvas cannot render them. Call workflow_list_node_types first if you are unsure which type to use.',
  parameters: {
    type: 'object',
    properties: {
      workflowId: { type: 'string', description: 'Workflow ID' },
      type: { type: 'string', description: 'Node type — must match a registered type exactly. Examples: "manual-trigger", "whatsapp", "llm-call", "code-execute", "http-request", "conditional", "data-store". Call workflow_list_node_types to see the full list.' },
      label: { type: 'string', description: 'Display label for the node' },
      config: { type: 'object', description: 'Node configuration (see node definition for its configSchema)' },
      position: { type: 'object', description: '{ x, y } canvas position', properties: { x: { type: 'number' }, y: { type: 'number' } } },
    },
    required: ['workflowId', 'type', 'label'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const type = args.type as string;
    const workflowId = args.workflowId as string;
    const typeErr = await validateNodeType(type);
    if (typeErr) return { success: false, error: typeErr };

    // One trigger per canvas — same rule the REST endpoint enforces.
    if (type === 'trigger') {
      const [existing] = await db
        .select()
        .from(workflowNodes)
        .where(and(eq(workflowNodes.workflowId, workflowId), eq(workflowNodes.type, 'trigger')));
      if (existing) {
        return {
          success: false,
          error: `A trigger node already exists on this canvas (id=${existing.id}). Use workflow_update_node to reconfigure it, or workflow_remove_node first.`,
        };
      }
    }

    const config = (args.config as Record<string, unknown>) || {};
    const configErr = await validateNodeConfig(type, config);
    if (configErr) return { success: false, error: configErr };

    const offending = credentialFields(config);
    if (offending.length > 0) return refuseCredentialConfig(offending);

    const explicitPosition = args.position as { x: number; y: number } | undefined;
    const position = explicitPosition ?? (await nextNodePosition(workflowId));

    const [node] = await db.insert(workflowNodes).values({
      workflowId,
      type,
      label: args.label as string,
      config,
      position,
    }).returning();
    publishWorkflowUpdate({
      workflowId,
      kind: 'node_added',
      nodeId: node.id,
      summary: node.label,
      node: {
        id: node.id,
        type: node.type,
        label: node.label,
        config: node.config,
        position: node.position,
      },
      ts: Date.now(),
    });
    return { success: true, data: node };
  },
});

/**
 * Pick a fresh canvas position for a brand-new node so individual
 * `workflow_add_node` calls don't pile up at (0, 0). Lays nodes out in a
 * 3-column grid below / to the right of whatever's already there, matching
 * the spacing `workflow_build_from_spec` uses for batch inserts.
 */
async function nextNodePosition(workflowId: string): Promise<{ x: number; y: number }> {
  const COL_W = 280;
  const ROW_H = 160;
  const COLS = 3;
  const ORIGIN_X = 240;
  const ORIGIN_Y = 20;
  const existing = await db
    .select({ position: workflowNodes.position })
    .from(workflowNodes)
    .where(eq(workflowNodes.workflowId, workflowId));
  const used = new Set<string>();
  for (const row of existing) {
    const p = row.position as { x?: number; y?: number } | null;
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
    used.add(`${Math.round(p.x)},${Math.round(p.y)}`);
  }
  for (let i = 0; i < 60; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = ORIGIN_X + col * COL_W;
    const y = ORIGIN_Y + row * ROW_H;
    if (!used.has(`${x},${y}`)) return { x, y };
  }
  // Past 60 slots — just stagger off the bottom so nothing exactly overlaps.
  return { x: ORIGIN_X, y: ORIGIN_Y + (existing.length + 1) * ROW_H };
}

register({
  name: 'workflow_list_node_types',
  description:
    'List registered workflow node types with their labels, categories and descriptions. This is the authoritative list — anything not in it will be rejected by workflow_add_node / workflow_update_node. ' +
    'PASS A `query` describing what you need ("whatsapp", "scrape a page", "run python") — the unfiltered catalogue is 88 types and costs ~5k tokens, a filtered one costs a few hundred. ' +
    'Only omit `query` when you genuinely need to survey everything.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Case-insensitive filter over type, label, category and description. Space-separated words are OR-ed, so "email whatsapp notify" returns every messaging node.',
      },
      category: {
        type: 'string',
        description: 'Exact category filter (e.g. "control", "integration"). Combine with query to narrow further.',
      },
    },
    required: [],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const { registry } = await import('$lib/workflows');
    const all = registry.listDefinitions().map((d) => ({
      type: d.type,
      label: d.label,
      category: d.category,
      description: d.description,
    })).sort((a, b) => a.type.localeCompare(b.type));

    const category = typeof args.category === 'string' ? args.category.trim().toLowerCase() : '';
    const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    const words = query ? query.split(/\s+/).filter(Boolean) : [];

    let defs = all;
    if (category) defs = defs.filter((d) => (d.category ?? '').toLowerCase() === category);
    if (words.length > 0) {
      defs = defs.filter((d) => {
        const hay = `${d.type} ${d.label} ${d.category} ${d.description}`.toLowerCase();
        return words.some((w) => hay.includes(w));
      });
    }

    // A filter that matches nothing is worse than no filter — the model would
    // conclude the capability does not exist and reach for jkai-node-builder.
    // Fall back to the full catalogue and say so.
    if (defs.length === 0 && (words.length > 0 || category)) {
      return {
        success: true,
        data: {
          matched: 0,
          note: `No node type matched ${category ? `category "${category}"` : ''}${category && query ? ' + ' : ''}${query ? `query "${query}"` : ''}. Returning the full catalogue — do not conclude the capability is missing without reading it.`,
          types: all,
        },
      };
    }

    return {
      success: true,
      data: {
        matched: defs.length,
        total: all.length,
        ...(defs.length < all.length
          ? { note: `Filtered to ${defs.length} of ${all.length} types. Re-run with a broader query if none fit.` }
          : {}),
        types: defs,
      },
    };
  },
});

register({
  name: 'workflow_describe_node',
  description:
    'Get the FULL detail for one or more node types — config schema (every field with type, required flag, enum values and defaults), input/output ports, usage guidance and example configs. ' +
    'Call this after workflow_list_node_types when you need the exact config keys before adding or updating nodes. ' +
    'PASS EVERY TYPE YOU PLAN TO USE IN ONE CALL: `types: ["llm-call","whatsapp","conditional"]`. A six-node build should cost one list + one describe, not seven round-trips. ' +
    'This returns the same grounding the orchestrator sees in its Node Registry — use it instead of guessing config shapes and getting rejected at write time.',
  parameters: {
    type: 'object',
    properties: {
      types: {
        type: 'array',
        items: { type: 'string' },
        description: 'Registered node types to describe, e.g. ["llm-call", "stealth-scrape", "conditional"]. Preferred over `type` — ask for everything the planned workflow needs at once.',
      },
      type: {
        type: 'string',
        description: 'Single registered node type. Accepted for convenience; prefer `types` when you need more than one.',
      },
    },
    required: [],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const requested = [
      ...(Array.isArray(args.types) ? (args.types as unknown[]) : []),
      ...(typeof args.type === 'string' ? [args.type] : []),
    ]
      .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      .map((t) => t.trim());
    const unique = [...new Set(requested)];

    if (unique.length === 0) {
      return { success: false, error: 'Pass `types` (array of node types) or `type` (single node type).' };
    }

    const { registry } = await import('$lib/workflows');
    const { buildSingleNodeGrounding } = await import('$lib/workflows/orchestrator/grounding');

    const described: Record<string, unknown>[] = [];
    const unknown: string[] = [];
    for (const type of unique) {
      const def = registry.getDefinition(type);
      if (!def) {
        unknown.push(type);
        continue;
      }
      described.push({
        type: def.type,
        label: def.label,
        category: def.category,
        description: def.description,
        inputs: def.inputs,
        outputs: def.outputs,
        configSchema: def.configSchema,
        defaultConfig: def.defaultConfig ?? {},
        required: def.configSchema?.required ?? [],
        examples: def.llmExamples ?? [],
        grounding: buildSingleNodeGrounding(def, []),
      });
    }

    // All-unknown is a real failure. A partial miss is not: returning the good
    // ones alongside the bad saves the model re-requesting the whole batch.
    if (described.length === 0) {
      const valid = registry.listDefinitions().map((d) => d.type).sort();
      return {
        success: false,
        error: `Unknown node type(s): ${unknown.join(', ')}. Valid types: ${valid.join(', ')}. Call workflow_list_node_types with a query for labels/descriptions.`,
      };
    }

    return {
      success: true,
      data: {
        nodes: described,
        ...(unknown.length > 0
          ? {
              unknown,
              note: `Not registered: ${unknown.join(', ')}. Call workflow_list_node_types with a query to find the right type — do not invent one.`,
            }
          : {}),
        // Kept so existing single-type callers that read data.configSchema keep working.
        ...(described.length === 1 ? described[0] : {}),
      },
    };
  },
});

register({
  name: 'workflow_remove_node',
  description: 'Remove a node from a workflow (also removes all connected edges)',
  parameters: {
    type: 'object',
    properties: { nodeId: { type: 'string', description: 'Node ID to remove' } },
    required: ['nodeId'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const nodeId = args.nodeId as string;
    const [existing] = await db.select().from(workflowNodes).where(eq(workflowNodes.id, nodeId)).limit(1);
    if (!existing) return { success: false, error: 'Node not found' };

    const connectedEdges = await db
      .select()
      .from(workflowEdges)
      .where(or(eq(workflowEdges.sourceNodeId, nodeId), eq(workflowEdges.targetNodeId, nodeId)));

    await db.delete(workflowNodes).where(eq(workflowNodes.id, nodeId));
    publishWorkflowUpdate({
      workflowId: existing.workflowId,
      kind: 'node_removed',
      nodeId,
      summary: existing.label,
      ts: Date.now(),
    });
    return { success: true, data: { deleted: true, label: existing.label, edgesRemoved: connectedEdges.length } };
  },
});

// ==========================================
// Update Tools — Edges
// ==========================================

register({
  name: 'workflow_add_edge',
  description: 'Connect two nodes in a workflow',
  parameters: {
    type: 'object',
    properties: {
      workflowId: { type: 'string', description: 'Workflow ID' },
      sourceNodeId: { type: 'string', description: 'Source node ID' },
      targetNodeId: { type: 'string', description: 'Target node ID' },
      sourceHandle: { type: 'string', description: 'Source handle (e.g. "success", "error"). Omit for default.' },
      targetHandle: { type: 'string', description: 'Target handle. Omit for default.' },
    },
    required: ['workflowId', 'sourceNodeId', 'targetNodeId'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const [edge] = await db.insert(workflowEdges).values({
      workflowId: args.workflowId as string,
      sourceNodeId: args.sourceNodeId as string,
      targetNodeId: args.targetNodeId as string,
      sourceHandle: (args.sourceHandle as string) || null,
      targetHandle: (args.targetHandle as string) || null,
    }).returning();
    publishWorkflowUpdate({
      workflowId: edge.workflowId,
      kind: 'edge_added',
      edgeId: edge.id,
      edge: {
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      },
      ts: Date.now(),
    });

    // If this edge just created a fan-in whose branches overwrite each other,
    // say so HERE — at the moment the mistake is made and cheap to undo, rather
    // than leaving it to surface as an unrelated failure on the first real run.
    const collisions = await fanInWarnings(edge.workflowId);
    const hit = collisions.find((c) => c.nodeId === edge.targetNodeId);
    return { success: true, data: hit ? { ...edge, warning: hit.message } : edge };
  },
});

register({
  name: 'workflow_remove_edge',
  description: 'Remove a connection between workflow nodes',
  parameters: {
    type: 'object',
    properties: { edgeId: { type: 'string', description: 'Edge ID' } },
    required: ['edgeId'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const [existing] = await db.select().from(workflowEdges).where(eq(workflowEdges.id, args.edgeId as string)).limit(1);
    if (!existing) return { success: false, error: 'Edge not found' };
    await db.delete(workflowEdges).where(eq(workflowEdges.id, args.edgeId as string));
    publishWorkflowUpdate({
      workflowId: existing.workflowId,
      kind: 'edge_removed',
      edgeId: existing.id,
      ts: Date.now(),
    });
    return { success: true, data: { deleted: true } };
  },
});

register({
  name: 'workflow_update_edge',
  description: "Change an edge's routing — reconnect to different nodes or change handles",
  parameters: {
    type: 'object',
    properties: {
      edgeId: { type: 'string', description: 'Edge ID' },
      sourceNodeId: { type: 'string', description: 'New source node ID' },
      targetNodeId: { type: 'string', description: 'New target node ID' },
      sourceHandle: { type: 'string', description: 'New source handle' },
      targetHandle: { type: 'string', description: 'New target handle' },
    },
    required: ['edgeId'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const edgeId = args.edgeId as string;
    const updates: Record<string, unknown> = {};
    if (args.sourceNodeId) updates.sourceNodeId = args.sourceNodeId;
    if (args.targetNodeId) updates.targetNodeId = args.targetNodeId;
    if (args.sourceHandle !== undefined) updates.sourceHandle = args.sourceHandle || null;
    if (args.targetHandle !== undefined) updates.targetHandle = args.targetHandle || null;
    const [edge] = await db.update(workflowEdges).set(updates).where(eq(workflowEdges.id, edgeId)).returning();
    if (edge) {
      publishWorkflowUpdate({
        workflowId: edge.workflowId,
        kind: 'edge_added',
        edgeId: edge.id,
        edge: {
          id: edge.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
        },
        ts: Date.now(),
      });
    }
    return edge ? { success: true, data: edge } : { success: false, error: 'Edge not found' };
  },
});

// ==========================================
// Update Tools — Schedules
// ==========================================

/**
 * Normalise a schedule config so the cron string lands on `config.expression`
 * — the only key the in-memory cron runner (scheduler.registerCronJob) reads.
 * These tools' descriptions historically suggested `{ cron: "..." }`, which
 * saved fine but never registered (enabled-but-dormant). Accept either key and
 * canonicalise to `expression` so new schedules actually fire.
 */
function normalizeScheduleConfig(config: Record<string, unknown> | undefined): Record<string, unknown> {
  const cfg = { ...(config ?? {}) };
  if (typeof cfg.expression !== 'string' && typeof cfg.cron === 'string') {
    cfg.expression = cfg.cron;
  }
  return cfg;
}

register({
  name: 'workflow_add_schedule',
  description: 'Add a cron schedule to a workflow',
  parameters: {
    type: 'object',
    properties: {
      workflowId: { type: 'string', description: 'Workflow ID' },
      type: { type: 'string', description: 'Schedule type (e.g. "cron")' },
      config: { type: 'object', description: 'Schedule config. For cron, set the 5-field cron string as { "expression": "0 8 * * *" } (daily at 8am). "cron" is accepted as an alias. Times are interpreted in Europe/London (so "0 8" means 8am the owner\'s time, all year) unless you set { "timezone": "..." } to an IANA zone.' },
    },
    required: ['workflowId', 'type', 'config'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const [schedule] = await db.insert(workflowSchedules).values({
      workflowId: args.workflowId as string,
      type: args.type as string,
      config: normalizeScheduleConfig(args.config as Record<string, unknown>),
    }).returning();
    const { reloadSchedule } = await import('$lib/workflows/scheduler');
    await reloadSchedule(schedule.id);
    return { success: true, data: schedule };
  },
});

register({
  name: 'workflow_update_schedule',
  description: 'Enable/disable a schedule or change its cron config',
  parameters: {
    type: 'object',
    properties: {
      scheduleId: { type: 'string', description: 'Schedule ID' },
      enabled: { type: 'boolean', description: 'Enable or disable' },
      config: { type: 'object', description: 'New schedule config' },
    },
    required: ['scheduleId'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const updates: Record<string, unknown> = {};
    if (args.enabled !== undefined) updates.enabled = args.enabled;
    if (args.config) updates.config = normalizeScheduleConfig(args.config as Record<string, unknown>);
    const scheduleId = args.scheduleId as string;
    const [schedule] = await db
      .update(workflowSchedules)
      .set(updates)
      .where(eq(workflowSchedules.id, scheduleId))
      .returning();
    if (!schedule) return { success: false, error: 'Schedule not found' };
    const { reloadSchedule } = await import('$lib/workflows/scheduler');
    await reloadSchedule(scheduleId);
    return { success: true, data: schedule };
  },
});

register({
  name: 'workflow_remove_schedule',
  description: 'Remove a schedule from a workflow',
  parameters: {
    type: 'object',
    properties: { scheduleId: { type: 'string', description: 'Schedule ID' } },
    required: ['scheduleId'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const scheduleId = args.scheduleId as string;
    const [existing] = await db.select().from(workflowSchedules).where(eq(workflowSchedules.id, scheduleId)).limit(1);
    if (!existing) return { success: false, error: 'Schedule not found' };
    const { unregisterCronJob } = await import('$lib/workflows/scheduler');
    unregisterCronJob(scheduleId);
    await db.delete(workflowSchedules).where(eq(workflowSchedules.id, scheduleId));
    return { success: true, data: { deleted: true } };
  },
});

// ==========================================
// Run / Test Tools
// ==========================================

register({
  name: 'workflow_run',
  description:
    'Trigger a workflow run on behalf of the user. Creates a manual run, fires the engine, and returns the runId. ' +
    'When `awaitMs` is set (max 600000 = 10 min), the call BLOCKS until the run completes/fails or the timeout elapses, ' +
    'and returns the full run + node executions inline. When unset, returns immediately and the run continues in the background — ' +
    'pair with workflow_get_run to inspect later, or call workflow_subscribe to receive results in a future iteration.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Workflow ID to run' },
      input: {
        type: 'object',
        description: 'Optional initial input passed to the trigger node. Defaults to {}.',
      },
      selfHealing: {
        type: 'boolean',
        description: 'If true (default), the engine attempts to auto-heal node config errors. Set false for strict test runs.',
      },
      awaitMs: {
        type: 'number',
        description: 'Max milliseconds to wait for completion (max 600000). When set, the call returns the full run result.',
      },
    },
    required: ['id'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  producesLongRunningTask: { kind: 'workflow_run', idPath: 'runId', cadenceSeconds: 30 },
  handler: async (args) => {
    const id = args.id as string;
    const initialInput = (args.input as Record<string, unknown>) ?? {};
    const selfHealing = args.selfHealing !== false;
    const awaitMs = typeof args.awaitMs === 'number' ? Math.min(Math.max(args.awaitMs, 0), 600_000) : 0;

    const [workflow] = await db.select().from(workflows).where(eq(workflows.id, id)).limit(1);
    if (!workflow) return { success: false, error: 'Workflow not found' };

    const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, id));
    const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, id));

    const { isDisplayOnlyType } = await import('$lib/workflows/types');
    const runnableNodes = nodes.filter((n) => !isDisplayOnlyType(n.type));
    const runnableEdges = edges.filter((e) => {
      const src = runnableNodes.find((n) => n.id === e.sourceNodeId);
      const tgt = runnableNodes.find((n) => n.id === e.targetNodeId);
      return src && tgt;
    });

    const [run] = await db.insert(workflowRuns).values({
      workflowId: id,
      status: 'running',
      trigger: 'manual',
      startedAt: new Date(),
    }).returning();

    for (const node of runnableNodes) {
      await db.insert(nodeExecutions).values({
        runId: run.id,
        nodeId: node.id,
        status: 'pending',
      });
    }

    const definition = {
      id: workflow.id,
      name: workflow.name,
      nodes: runnableNodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position as { x: number; y: number },
        config: (n.config || {}) as Record<string, unknown>,
        label: n.label,
      })),
      edges: runnableEdges.map((e) => ({
        id: e.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      })),
    };

    const { runWorkflowAndPersist } = await import('$lib/workflows/run-helpers');
    runWorkflowAndPersist(definition, run.id, initialInput, {
      workflowId: id,
      selfHealing,
      label: 'orchestrator-run',
    });

    if (awaitMs > 0) {
      const deadline = Date.now() + awaitMs;
      const pollInterval = 1500;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollInterval));
        const [latest] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, run.id)).limit(1);
        if (!latest) break;
        if (latest.status === 'completed' || latest.status === 'completed_with_errors' || latest.status === 'failed' || latest.status === 'cancelled') {
          const execs = await db
            .select()
            .from(nodeExecutions)
            .where(eq(nodeExecutions.runId, run.id))
            .orderBy(asc(nodeExecutions.startedAt));
          return {
            success: true,
            data: {
              runId: run.id,
              status: latest.status,
              awaited: true,
              error: latest.error,
              completedAt: latest.completedAt,
              nodeExecutions: execs.map((e) => ({
                nodeId: e.nodeId,
                status: e.status,
                inputData: e.inputData,
                outputData: e.outputData,
                error: e.error,
              })),
            },
          };
        }
      }
      return {
        success: true,
        data: {
          runId: run.id,
          status: 'running',
          awaited: true,
          timedOut: true,
          message: `Run did not complete within ${awaitMs}ms. Subscribe via workflow_subscribe to receive the result in a future iteration, or poll with workflow_get_run.`,
        },
      };
    }

    return {
      success: true,
      data: {
        runId: run.id,
        status: 'running',
        message: 'Run started in background. Wait a few seconds, then call workflow_get_run with this runId to see results.',
      },
    };
  },
});

register({
  name: 'workflow_subscribe',
  description:
    'Subscribe a JKAI build to a workflow. When the workflow next runs to completion (via schedule, manual trigger, event, or another tool call), ' +
    'the result is queued as a pending delivery and surfaced at the top of the build\'s next iteration prompt. ' +
    'Use this when the builder needs an asynchronous data source it can react to without blocking the current iteration.',
  parameters: {
    type: 'object',
    properties: {
      buildId: { type: 'string', description: 'Build ID to receive deliveries' },
      workflowId: { type: 'string', description: 'Workflow whose run completions should be delivered' },
    },
    required: ['buildId', 'workflowId'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const buildId = args.buildId as string;
    const workflowId = args.workflowId as string;
    const { jkaiBuilds, buildWorkflowSubscriptions } = await import('$lib/db/schema');
    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId)).limit(1);
    if (!build) return { success: false, error: 'Build not found' };
    const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
    if (!wf) return { success: false, error: 'Workflow not found' };
    await db
      .insert(buildWorkflowSubscriptions)
      .values({ buildId, workflowId })
      .onConflictDoNothing();
    return { success: true, data: { buildId, workflowId, message: 'Subscribed. Future completed runs of this workflow will deliver to the build.' } };
  },
});

register({
  name: 'workflow_unsubscribe',
  description: 'Remove a workflow subscription from a build.',
  parameters: {
    type: 'object',
    properties: {
      buildId: { type: 'string' },
      workflowId: { type: 'string' },
    },
    required: ['buildId', 'workflowId'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const buildId = args.buildId as string;
    const workflowId = args.workflowId as string;
    const { buildWorkflowSubscriptions } = await import('$lib/db/schema');
    await db
      .delete(buildWorkflowSubscriptions)
      .where(and(eq(buildWorkflowSubscriptions.buildId, buildId), eq(buildWorkflowSubscriptions.workflowId, workflowId)));
    return { success: true, data: { buildId, workflowId, message: 'Unsubscribed.' } };
  },
});

register({
  name: 'workflow_clear_data_store',
  destructive: true,
  description:
    'Clear entries from a workflow\'s data store. Use this to enable smoother test runs of pipelines that dedupe via stored "seen" keys. ' +
    'Three modes (pick one): pass `keys` to wipe specific keys (e.g. ["seen_urls"]), `all: true` to wipe every key for the workflow, ' +
    'or `sinceLastNRuns` to wipe entries written/updated during the last N completed runs. ' +
    'Always confirm with the user before calling — this is destructive within the workflow\'s scoped store.',
  parameters: {
    type: 'object',
    properties: {
      workflowId: { type: 'string', description: 'Workflow ID whose data store should be cleared' },
      keys: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific store keys to delete. Mutually exclusive with `all` and `sinceLastNRuns`.',
      },
      all: {
        type: 'boolean',
        description: 'When true, delete every data-store row for this workflow.',
      },
      sinceLastNRuns: {
        type: 'number',
        description: 'Delete data-store rows whose updatedAt is on/after the start time of the Nth most recent run.',
      },
    },
    required: ['workflowId'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const workflowId = args.workflowId as string;
    const keys = Array.isArray(args.keys) ? (args.keys as string[]) : null;
    const all = args.all === true;
    const sinceLastNRuns = typeof args.sinceLastNRuns === 'number' ? args.sinceLastNRuns : null;

    const modes = [keys && keys.length > 0, all, sinceLastNRuns !== null].filter(Boolean).length;
    if (modes !== 1) {
      return {
        success: false,
        error: 'Pick exactly one of: `keys` (non-empty array), `all: true`, or `sinceLastNRuns` (number).',
      };
    }

    const [workflow] = await db.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
    if (!workflow) return { success: false, error: 'Workflow not found' };

    if (keys && keys.length > 0) {
      const deleted = await db
        .delete(workflowDataStore)
        .where(
          and(
            eq(workflowDataStore.workflowId, workflowId),
            inArray(workflowDataStore.key, keys),
          ),
        )
        .returning({ key: workflowDataStore.key });
      return {
        success: true,
        data: { mode: 'keys', deletedCount: deleted.length, deletedKeys: deleted.map((d) => d.key) },
      };
    }

    if (all) {
      const deleted = await db
        .delete(workflowDataStore)
        .where(eq(workflowDataStore.workflowId, workflowId))
        .returning({ key: workflowDataStore.key });
      return {
        success: true,
        data: { mode: 'all', deletedCount: deleted.length, deletedKeys: deleted.map((d) => d.key) },
      };
    }

    // sinceLastNRuns mode
    const n = Math.max(1, Math.floor(sinceLastNRuns!));
    const recentRuns = await db
      .select({ startedAt: workflowRuns.startedAt })
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, workflowId))
      .orderBy(desc(workflowRuns.startedAt))
      .limit(n);

    const runsWithStart = recentRuns.filter((r): r is { startedAt: Date } => r.startedAt !== null);
    if (runsWithStart.length === 0) {
      return { success: true, data: { mode: 'sinceLastNRuns', deletedCount: 0, deletedKeys: [], note: 'No prior runs with a start time found.' } };
    }

    const cutoff = runsWithStart[runsWithStart.length - 1].startedAt;
    const deleted = await db
      .delete(workflowDataStore)
      .where(
        and(
          eq(workflowDataStore.workflowId, workflowId),
          gte(workflowDataStore.updatedAt, cutoff),
        ),
      )
      .returning({ key: workflowDataStore.key });

    return {
      success: true,
      data: {
        mode: 'sinceLastNRuns',
        runsConsidered: recentRuns.length,
        cutoffStartedAt: cutoff.toISOString(),
        deletedCount: deleted.length,
        deletedKeys: deleted.map((d) => d.key),
      },
    };
  },
});

register({
  name: 'workflow_lint',
  description:
    'Run a static linter over a workflow\'s nodes/edges before triggering a run. Catches the common authoring mistakes: ' +
    'unsupported template syntax, unknown config keys, code-execute body issues, and {{input.X}} references that don\'t match the upstream schema. ' +
    'Returns issues with severity. Call this after any structural edit to catch failures cheaply, before workflow_run.',
  parameters: {
    type: 'object',
    properties: {
      workflowId: { type: 'string', description: 'Workflow ID to lint' },
    },
    required: ['workflowId'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const workflowId = args.workflowId as string;
    const [workflow] = await db.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
    if (!workflow) return { success: false, error: 'Workflow not found' };

    const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, workflowId));
    const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, workflowId));

    const { registry } = await import('$lib/workflows');
    const { verifyWorkflow, formatIssues } = await import('$lib/workflows/orchestrator/verify');

    const nodeDefs = nodes.map((n) => ({
      id: n.id,
      type: n.type,
      label: n.label,
      position: n.position as { x: number; y: number },
      config: (n.config || {}) as Record<string, unknown>,
    }));
    const edgeDefs = edges.map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    }));

    const getOutputSchema = (type: string, config: Record<string, unknown>) => {
      const executor = registry.getExecutor(type);
      if (executor) return executor.getOutputSchema(config);
      return { type: 'object' as const };
    };

    const issues = verifyWorkflow(
      nodeDefs,
      edgeDefs,
      (type) => registry.getDefinition(type),
      getOutputSchema,
    );

    const errors = issues.filter((i) => i.severity === 'error');
    const warnings = issues.filter((i) => i.severity === 'warning');

    return {
      success: true,
      data: {
        ok: errors.length === 0,
        errorCount: errors.length,
        warningCount: warnings.length,
        issues,
        report: issues.length === 0 ? 'No issues found.' : formatIssues(issues),
      },
    };
  },
});

// ==========================================
// workflow_generate — rich generator entry point (#4).
//
// Hand-authoring a DAG node-by-node (workflow_add_node / workflow_build_from_spec)
// bypasses the in-repo orchestrator generator, which already does node-registry
// grounding, a critic-revision debate round, post-build verification, and a
// targeted self-heal pass. This tool exposes that generator directly to the
// agent: give it the natural-language request and (optionally) a workflowId to
// modify, and it grounds + builds + critiques + verifies + heals, persists the
// result, then runs a final blocking verification sweep so the agent gets the
// same needs_fix signal workflow_build_from_spec produces.
// ==========================================
register({
  name: 'workflow_generate',
  description:
    'Generate (or modify) a complete workflow from a natural-language request using the in-repo rich generator. ' +
    'PREFER THIS over hand-authoring a DAG with workflow_build_from_spec / workflow_add_node when the user describes what they want in prose. ' +
    'The generator grounds itself in the live node registry, plans the nodes + wiring, runs a critic-revision round, then verifies and self-heals the result before saving — so you get a correct, runnable workflow instead of guessing config shapes yourself. ' +
    'Pass `prompt` with the full request (e.g. "every morning at 8am, fetch my Hacker News front page and WhatsApp me the top 5 titles"). ' +
    'Omit `workflowId` to create a brand-new canvas; pass an existing `workflowId` to regenerate/modify that workflow in place. ' +
    'Returns the workflowId, canvas URL, a human summary, and the final verification status. ' +
    'If `verificationPassed` is false, the workflow was saved but has blocking errors you must resolve with workflow_update_node before telling the user it is done.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description:
          'The natural-language workflow request — what should the workflow do, when should it fire, and what should it produce. Be specific; the generator builds directly from this.',
      },
      workflowId: {
        type: 'string',
        description:
          'Optional. When provided, the generator modifies THIS existing workflow (its current nodes/edges are replaced with the regenerated graph). Omit to create a new canvas.',
      },
    },
    required: ['prompt'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args, ctx) => {
    const emit = ctx?.emit ?? (() => {});
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
    if (!prompt) return { success: false, error: '`prompt` (string) is required.' };

    // If a canvas chat threads its workflow_id through as conversationId, and
    // the caller didn't pass an explicit workflowId, default to modifying the
    // current canvas — same UUID-shaped signal workflow_build_from_spec uses.
    const isUuid = (v: unknown): v is string =>
      typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    let workflowId: string | null =
      typeof args.workflowId === 'string' && args.workflowId.trim()
        ? args.workflowId.trim()
        : (isUuid(ctx?.conversationId) ? (ctx!.conversationId as string) : null);

    // Lazy-import the rich generator + persistence helpers. Matches the rest of
    // this file (orchestrator deps are always lazily imported to avoid circular
    // init between site-tools and the workflow registry).
    const { generateWorkflow, saveWorkflowFromGenerated, runWorkflowVerification } =
      await import('$lib/workflows/orchestrator');
    const { formatIssues } = await import('$lib/workflows/orchestrator/verify');

    // The generator's onChunk maps cleanly onto ctx.emit — every planning step
    // ("Adding cron trigger", "Reviewing with the critic", "Verification …")
    // surfaces as a `status` progress event on the chat stream, exactly like
    // the orchestrator chat route does via onProgress.
    let result;
    try {
      result = await generateWorkflow(prompt, workflowId, (text) => emit(text.trimEnd()));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Workflow generation failed: ${msg}` };
    }

    // The generator can pause to ask a clarifying question instead of building.
    if (result.followUp) {
      return {
        success: true,
        data: {
          status: 'needs_clarification',
          workflowId: workflowId ?? undefined,
          followUp: result.followUp,
          message: result.followUp,
        },
      };
    }

    const workflow = result.workflow;
    if (workflow && workflow.nodes.length > 0) {
      // Guard the generated graph BEFORE persisting. The generator is an LLM too,
      // and a prompt like "call the API with key sk-…" hands it a live secret to
      // copy into a node config. Same refusal as the hand-authored paths.
      const generatedOffenders = [
        ...new Set(
          workflow.nodes.flatMap((n) => credentialFields((n.config ?? {}) as Record<string, unknown>)),
        ),
      ];
      if (generatedOffenders.length > 0) return refuseCredentialConfig(generatedOffenders);
    }
    if (!workflow || workflow.nodes.length === 0) {
      return {
        success: false,
        error:
          'The generator could not produce a valid workflow from that prompt. Try being more specific about the trigger, the steps, and the desired output.',
      };
    }

    // Persist. Existing workflow → replace nodes/edges in place. New canvas →
    // allocate a name and insert the whole graph atomically (mirrors the
    // orchestrator chat route's generate path).
    const baseUrl = (process.env.PUBLIC_SITE_URL || 'https://strangeramblings.com').replace(/\/+$/, '');
    let slug: string;
    try {
      if (workflowId) {
        await saveWorkflowFromGenerated(workflowId, workflow);
        const [row] = await db.select({ name: workflows.name }).from(workflows).where(eq(workflows.id, workflowId)).limit(1);
        slug = row?.name?.startsWith('canvas:') ? row.name.slice('canvas:'.length) : workflowId;
      } else {
        const { allocateCanvasName } = await import('$lib/canvas/adapter.server');
        const { name: canvasName, slug: canvasSlug } = await allocateCanvasName(workflow.name || 'generated workflow');
        slug = canvasSlug;
        workflowId = await db.transaction(async (tx) => {
          const [createdRow] = await tx.insert(workflows).values({
            name: canvasName,
            description: workflow.description || workflow.name || null,
            trigger: workflow.trigger ?? { type: 'manual' },
          }).returning();
          await tx.insert(workflowNodes).values(
            workflow.nodes.map((n) => ({ id: n.id, workflowId: createdRow.id, type: n.type, position: n.position, config: n.config, label: n.label })),
          );
          if (workflow.edges.length > 0) {
            await tx.insert(workflowEdges).values(
              workflow.edges.map((e) => ({ id: e.id, workflowId: createdRow.id, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, sourceHandle: e.sourceHandle || null, targetHandle: e.targetHandle || null })),
            );
          }
          return createdRow.id;
        });
      }
    } catch (dbErr: unknown) {
      const msg = dbErr instanceof Error ? dbErr.message : 'Unknown DB error';
      return { success: false, error: `Generated workflow but failed to save it: ${msg}` };
    }

    const url = `${baseUrl}/jkai/canvas/${slug}`;
    publishWorkflowUpdate({ workflowId, kind: 'build_complete', summary: 'Generated', ts: Date.now() });

    // Final blocking verification over the PERSISTED graph — same semantics as
    // workflow_build_from_spec (#5). The generator already verifies+heals
    // internally, but this sweep is the authoritative gate on the saved state.
    const issues = runWorkflowVerification(workflow.nodes, workflow.edges) as SummaryIssue[];
    const errorIssues = issues.filter((i) => i.severity === 'error');

    const summaryMarkdown = buildWorkflowSummaryMarkdown({
      linkLabel: workflow.name || 'Workflow',
      url,
      description: workflow.description,
      nodes: workflow.nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, config: (n.config ?? {}) as Record<string, unknown> })),
      edges: workflow.edges.map((e) => ({ sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId })),
      issues,
    });

    const data = {
      workflowId,
      slug,
      name: workflow.name,
      description: workflow.description,
      nodeCount: workflow.nodes.length,
      url,
      summaryMarkdown,
      linkMarkdown: `[${workflow.name || 'Workflow'}](${url})`,
      verificationIssues: issues,
      verificationPassed: errorIssues.length === 0,
      status: errorIssues.length === 0 ? 'generated' : 'needs_fix',
      explanation: workflow.explanation,
    };

    if (errorIssues.length > 0) {
      return {
        success: false,
        error:
          `Workflow "${workflow.name}" was generated and saved at ${url}, but verification found ${errorIssues.length} blocking error(s) — fix them before telling the user it's done:\n\n` +
          formatIssues(errorIssues) +
          `\n\n${REPAIR_DONT_REBUILD}`,
        data,
      };
    }

    return { success: true, data };
  },
});
