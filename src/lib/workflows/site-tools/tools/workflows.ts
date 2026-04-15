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
import { desc, eq, asc, and, or } from 'drizzle-orm';
import { formatTimestamp } from '../format-time';

// ==========================================
// Existing Tools (moved)
// ==========================================

register({
  name: 'workflow_create',
  description: 'Create an automated workflow from a natural language description. Use this when the user needs something that runs automatically or on a schedule — things like "every morning send me a health summary", "check X every hour and notify me". The workflow engine supports: manual-trigger (with cron scheduling), WhatsApp messaging, Home Assistant queries/control, LLM calls, code execution, Strava, blog, email, loops, data stores, conditionals, and more. The trigger node is always manual-trigger (supports cron schedules). For event-driven HA automations, create a scheduled workflow that polls state. After creating, share the returned URL as a clickable markdown link: [Review workflow](url).',
  parameters: {
    type: 'object',
    properties: {
      description: { type: 'string', description: 'Natural language description of what the workflow should do. Be specific about triggers, conditions, and actions.' },
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
      return { success: false, error: 'Could not generate a valid workflow. Try being more specific about what triggers it and what it should do.' };
    }

    const [created] = await db.insert(workflows).values({
      name: workflow.name || 'Generated Workflow',
      description: workflow.description || null,
    }).returning();

    try {
      await db.insert(workflowNodes).values(
        workflow.nodes.map((n) => ({ id: n.id, workflowId: created.id, type: n.type, position: n.position, config: n.config, label: n.label })),
      );
      if (workflow.edges.length > 0) {
        await db.insert(workflowEdges).values(
          workflow.edges.map((e) => ({ id: e.id, workflowId: created.id, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, sourceHandle: e.sourceHandle || null, targetHandle: e.targetHandle || null })),
        );
      }
    } catch (dbErr: unknown) {
      await db.delete(workflows).where(eq(workflows.id, created.id));
      const dbMsg = dbErr instanceof Error ? dbErr.message : 'Unknown DB error';
      return { success: false, error: `Failed to save workflow: ${dbMsg}` };
    }

    return {
      success: true,
      data: {
        workflowId: created.id,
        name: workflow.name,
        description: workflow.description,
        explanation: workflow.explanation,
        nodeCount: workflow.nodes.length,
        url: `https://strangeramblings.com/workflows/${created.id}`,
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
  description: 'Delete a workflow by ID. Use when the user asks to remove or clean up a workflow.',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Workflow ID to delete' } },
    required: ['id'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const [existing] = await db.select().from(workflows).where(eq(workflows.id, args.id as string)).limit(1);
    if (!existing) return { success: false, error: 'Workflow not found' };
    await db.delete(workflows).where(eq(workflows.id, args.id as string));
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
        url: `https://strangeramblings.com/workflows/${id}`,
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

register({
  name: 'workflow_update_node',
  description: "Update a workflow node's config, label, or type",
  parameters: {
    type: 'object',
    properties: {
      nodeId: { type: 'string', description: 'Node ID' },
      config: { type: 'object', description: 'New config (merged with existing)' },
      label: { type: 'string', description: 'New label' },
      type: { type: 'string', description: 'New node type' },
    },
    required: ['nodeId'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const nodeId = args.nodeId as string;
    const [existing] = await db.select().from(workflowNodes).where(eq(workflowNodes.id, nodeId)).limit(1);
    if (!existing) return { success: false, error: 'Node not found' };

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
  description: 'Add a new node to a workflow',
  parameters: {
    type: 'object',
    properties: {
      workflowId: { type: 'string', description: 'Workflow ID' },
      type: { type: 'string', description: 'Node type (e.g. "whatsapp-message", "llm-call", "code-exec")' },
      label: { type: 'string', description: 'Display label for the node' },
      config: { type: 'object', description: 'Node configuration' },
      position: { type: 'object', description: '{ x, y } canvas position', properties: { x: { type: 'number' }, y: { type: 'number' } } },
    },
    required: ['workflowId', 'type', 'label'],
  },
  category: 'Workflows',
  toolset: 'workflows',
  handler: async (args) => {
    const [node] = await db.insert(workflowNodes).values({
      workflowId: args.workflowId as string,
      type: args.type as string,
      label: args.label as string,
      config: (args.config as Record<string, unknown>) || {},
      position: (args.position as { x: number; y: number }) || { x: 0, y: 0 },
    }).returning();
    return { success: true, data: node };
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
