import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowNodes, workflowEdges } from '$lib/db/schema';
import { and, eq, or } from 'drizzle-orm';
import { recordAudit, recordAuditBatch } from '$lib/canvas/audit';
import { diffNodePatch } from '$lib/canvas/audit-diff';
import { registry } from '$lib/workflows';
import { resolveUpstreamSchema, schemaToVariablePaths } from '$lib/workflows/schema-propagation';

/**
 * Declared upstream field paths for this node — derived from each upstream
 * node's executor.getOutputSchema(config), NOT from run data. Lets the config
 * panel's `{{` field picker show available fields BEFORE the node has ever run
 * (the canvas merges these with computeUpstreamFields' run-data paths). Closes
 * the chicken-and-egg gap where pickers were empty on a fresh canvas.
 */
export const GET: RequestHandler = async ({ params }) => {
  const [nodes, edges] = await Promise.all([
    db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, params.id)),
    db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, params.id)),
  ]);

  const getOutputSchema = (type: string, config: Record<string, unknown>) => {
    try {
      const exec = registry.getExecutor(type);
      return exec ? exec.getOutputSchema(config ?? {}) : { type: 'object' as const };
    } catch {
      return { type: 'object' as const };
    }
  };

  try {
    const schema = resolveUpstreamSchema(
      params.nodeId,
      nodes.map((n) => ({
        id: n.id,
        type: n.type,
        config: (n.config as Record<string, unknown>) ?? {},
        position: (n.position as { x: number; y: number }) ?? { x: 0, y: 0 },
        label: n.label,
      })),
      edges.map((e) => ({ id: e.id, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId })),
      getOutputSchema,
    );
    const paths = schemaToVariablePaths(schema).map((v) => v.path);
    return json({ paths });
  } catch {
    return json({ paths: [] });
  }
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  if (body.config !== undefined) updates.config = body.config;
  if (typeof body.label === 'string') updates.label = body.label;
  if (body.position && typeof body.position === 'object') updates.position = body.position;

  if (Object.keys(updates).length === 0) {
    return json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  // Load current state BEFORE the update so we can diff.
  const [before] = await db
    .select()
    .from(workflowNodes)
    .where(and(eq(workflowNodes.id, params.nodeId), eq(workflowNodes.workflowId, params.id)));
  if (!before) return json({ error: 'Node not found' }, { status: 404 });

  const [updated] = await db
    .update(workflowNodes)
    .set(updates)
    .where(and(eq(workflowNodes.id, params.nodeId), eq(workflowNodes.workflowId, params.id)))
    .returning();

  if (!updated) {
    return json({ error: 'Node not found' }, { status: 404 });
  }

  // Emit audit entries for non-cosmetic changes.
  const entries = diffNodePatch(
    {
      label: before.label,
      config: (before.config as Record<string, unknown>) ?? {},
      position: (before.position as { x: number; y: number }) ?? { x: 0, y: 0 },
    },
    {
      label: typeof body.label === 'string' ? body.label : undefined,
      config: body.config as Record<string, unknown> | undefined,
    },
  );
  if (entries.length > 0) {
    await recordAuditBatch(
      entries.map((e) => ({
        workflowId: params.id,
        entity: 'node' as const,
        entityId: params.nodeId,
        action: e.action,
        details: { ...e.details, label: updated.label, nodeType: updated.type },
      })),
    );
  }

  return json({ node: updated });
};

export const DELETE: RequestHandler = async ({ params }) => {
  // Remove inbound/outbound edges first to keep FK clean
  await db
    .delete(workflowEdges)
    .where(
      and(
        eq(workflowEdges.workflowId, params.id),
        or(
          eq(workflowEdges.sourceNodeId, params.nodeId),
          eq(workflowEdges.targetNodeId, params.nodeId),
        ),
      ),
    );

  const [removed] = await db
    .delete(workflowNodes)
    .where(and(eq(workflowNodes.id, params.nodeId), eq(workflowNodes.workflowId, params.id)))
    .returning();

  if (!removed) return json({ error: 'Node not found' }, { status: 404 });

  await recordAudit({
    workflowId: params.id,
    entity: 'node',
    entityId: removed.id,
    action: 'delete',
    details: { nodeType: removed.type, label: removed.label },
  });

  return json({ deleted: removed.id });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const action = body.action as string | undefined;

  const [src] = await db
    .select()
    .from(workflowNodes)
    .where(and(eq(workflowNodes.id, params.nodeId), eq(workflowNodes.workflowId, params.id)));
  if (!src) return json({ error: 'Node not found' }, { status: 404 });

  if (action === 'detach') {
    await db
      .delete(workflowEdges)
      .where(
        and(
          eq(workflowEdges.workflowId, params.id),
          or(
            eq(workflowEdges.sourceNodeId, params.nodeId),
            eq(workflowEdges.targetNodeId, params.nodeId),
          ),
        ),
      );
    return json({ detached: params.nodeId });
  }

  if (action === 'branch') {
    const pos = (src.position as { x?: number; y?: number }) || { x: 0, y: 0 };
    const [cloned] = await db
      .insert(workflowNodes)
      .values({
        workflowId: params.id,
        type: src.type,
        label: `${src.label} (branch)`,
        position: { x: (pos.x ?? 0) + 24, y: (pos.y ?? 0) + 120 },
        config: src.config,
      })
      .returning();
    return json({ node: cloned });
  }

  return json({ error: `Unknown action: ${action}` }, { status: 400 });
};
