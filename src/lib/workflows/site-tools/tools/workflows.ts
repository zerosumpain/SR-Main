import { register } from '../registry-internal';
import { db } from '$lib/db';
import {
  workflows,
  workflowNodes,
  workflowEdges,
  workflowRuns,
  workflowSchedules,
  nodeExecutions,
  orchestratorChats,
} from '$lib/db/schema';
import { desc, eq, asc, and, or, like } from 'drizzle-orm';
import { formatTimestamp } from '../format-time';
import { slugify } from '$lib/canvas/slug';

// ==========================================
// Existing Tools (moved)
// ==========================================

register({
  name: 'workflow_create',
  description:
    'Create a NEW separate canvas (workflow) from a natural language description. ' +
    'Only call this when the user explicitly asks for a new, separate canvas. ' +
    'If you are currently inside a canvas (see "Current Canvas" context) and the ' +
    'user is asking to build/extend it, use workflow_add_node / workflow_add_edge ' +
    'on the existing workflowId instead. ' +
    'The created canvas gets a trigger node + any generated nodes, and is available ' +
    'at the returned /jkai/canvas/:slug URL. ' +
    'Supported node types: trigger, chat, llm-call, llm-agent, text-parser, ' +
    'transform, http-request, conditional, delay, intel-write, intel-query, ' +
    'data-store, whatsapp, email, blog, home-assistant, and more. ' +
    'After creating, share the returned URL as a clickable markdown link: [Open canvas](url).',
  parameters: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'Natural language description of what the canvas should do.',
      },
    },
    required: ['description'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const { generateWorkflow } = await import('$lib/workflows/orchestrator');

    const description = args.description as string;
    const { workflow, followUp } = await generateWorkflow(description, null);

    if (followUp) {
      return { success: true, data: { needsMoreInfo: true, question: followUp } };
    }

    if (!workflow || workflow.nodes.length === 0) {
      return {
        success: false,
        error:
          'Could not generate a valid workflow. Try being more specific about triggers, inputs, and outputs.',
      };
    }

    // Canvas-compatible naming: pick a SHORT slug (≤ 24 chars, 3–4 words
    // max) from the generated title, ensure the "canvas:" prefix. If the
    // slug is already taken, append -2, -3, ... as a collision suffix.
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
    const baseSlug = shortSlug(workflow.name || 'generated');
    let slug = baseSlug;
    let attempt = 1;
    while (attempt < 50) {
      const [existing] = await db
        .select()
        .from(workflows)
        .where(eq(workflows.name, `canvas:${slug}`));
      if (!existing) break;
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
    }

    // Atomic: if any insert fails, the whole canvas rolls back. Previously
    // we created the workflow row then deleted it on error — which cascade-
    // wiped every row referencing that id. A rolled-back transaction leaves
    // no row to reference in the first place.
    let created: { id: string };
    try {
      created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(workflows)
          .values({
            name: `canvas:${slug}`,
            description: workflow.description || workflow.name || slug,
            trigger: { type: 'manual' },
          })
          .returning();

        const nodes = workflow.nodes.slice();
        let triggerNodeId: string | null = null;
        const legacyTriggerIdx = nodes.findIndex(
          (n) => n.type === 'trigger' || n.type === 'manual-trigger',
        );
        if (legacyTriggerIdx >= 0) {
          const existing = nodes[legacyTriggerIdx];
          triggerNodeId = existing.id;
          nodes[legacyTriggerIdx] = {
            ...existing,
            type: 'trigger',
            label: existing.label || 'Trigger',
            config: { kind: 'manual', ...(existing.config || {}) },
            position: existing.position || { x: 20, y: 20 },
          };
        } else {
          const newId = crypto.randomUUID();
          triggerNodeId = newId;
          nodes.unshift({
            id: newId,
            type: 'trigger',
            label: 'Trigger',
            config: { kind: 'manual' },
            position: { x: 20, y: 20 },
          });
        }

        await tx.insert(workflowNodes).values(
          nodes.map((n) => ({
            id: n.id,
            workflowId: row.id,
            type: n.type,
            position: n.position,
            config: n.config,
            label: n.label,
          })),
        );

        const edges = workflow.edges.slice();
        const triggerHasOutgoing = edges.some((e) => e.sourceNodeId === triggerNodeId);
        if (!triggerHasOutgoing) {
          const roots = nodes.filter(
            (n) => n.id !== triggerNodeId && !edges.some((e) => e.targetNodeId === n.id),
          );
          for (const root of roots.slice(0, 1)) {
            edges.push({
              id: crypto.randomUUID(),
              sourceNodeId: triggerNodeId,
              targetNodeId: root.id,
              sourceHandle: null,
              targetHandle: null,
            });
          }
        }

        if (edges.length > 0) {
          await tx.insert(workflowEdges).values(
            edges.map((e) => ({
              id: e.id,
              workflowId: row.id,
              sourceNodeId: e.sourceNodeId,
              targetNodeId: e.targetNodeId,
              sourceHandle: e.sourceHandle || null,
              targetHandle: e.targetHandle || null,
            })),
          );
        }

        return { id: row.id };
      });
    } catch (dbErr: unknown) {
      const dbMsg = dbErr instanceof Error ? dbErr.message : 'Unknown DB error';
      return { success: false, error: `Failed to save canvas: ${dbMsg}` };
    }

    return {
      success: true,
      data: {
        workflowId: created.id,
        slug,
        name: workflow.name,
        description: workflow.description,
        explanation: workflow.explanation,
        nodeCount: workflow.nodes.length,
        url: `https://strangeramblings.com/jkai/canvas/${slug}`,
      },
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

    return {
      success: true,
      data: {
        ...wf,
        nodes,
        edges,
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
  description: "Update a workflow node's config, label, or type. When changing type, the new type must exist in the node registry.",
  parameters: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Node ID' },
      config: { type: 'object', description: 'New config (merged with existing)' },
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
    if (args.config) {
      updates.config = { ...(existing.config as Record<string, unknown>), ...(args.config as Record<string, unknown>) };
    }

    const [node] = await db.update(workflowNodes).set(updates).where(eq(workflowNodes.id, nodeId)).returning();
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

    const [node] = await db.insert(workflowNodes).values({
      workflowId,
      type,
      label: args.label as string,
      config,
      position: (args.position as { x: number; y: number }) || { x: 0, y: 0 },
    }).returning();
    return { success: true, data: node };
  },
});

register({
  name: 'workflow_list_node_types',
  description: 'List all registered workflow node types with their labels, categories, and descriptions. Use this before workflow_add_node or workflow_update_node to discover the exact type string to use — this is the authoritative list, and anything not in it will be rejected.',
  parameters: { type: 'object', properties: {}, required: [] },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async () => {
    const { registry } = await import('$lib/workflows');
    const defs = registry.listDefinitions().map((d) => ({
      type: d.type,
      label: d.label,
      category: d.category,
      description: d.description,
    })).sort((a, b) => a.type.localeCompare(b.type));
    return { success: true, data: defs };
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
    return { success: true, data: edge };
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
    return edge ? { success: true, data: edge } : { success: false, error: 'Edge not found' };
  },
});

// ==========================================
// Update Tools — Schedules
// ==========================================

register({
  name: 'workflow_add_schedule',
  description: 'Add a cron schedule to a workflow',
  parameters: {
    type: 'object',
    properties: {
      workflowId: { type: 'string', description: 'Workflow ID' },
      type: { type: 'string', description: 'Schedule type (e.g. "cron")' },
      config: { type: 'object', description: 'Schedule config (e.g. { "cron": "0 8 * * *" } for daily at 8am)' },
    },
    required: ['workflowId', 'type', 'config'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const [schedule] = await db.insert(workflowSchedules).values({
      workflowId: args.workflowId as string,
      type: args.type as string,
      config: args.config as Record<string, unknown>,
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
    if (args.config) updates.config = args.config;
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
