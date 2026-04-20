import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowNodes, workflowEdges } from '$lib/db/schema';
import { and, eq, or } from 'drizzle-orm';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  if (body.config !== undefined) updates.config = body.config;
  if (typeof body.label === 'string') updates.label = body.label;
  if (body.position && typeof body.position === 'object') updates.position = body.position;

  if (Object.keys(updates).length === 0) {
    return json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  const [updated] = await db
    .update(workflowNodes)
    .set(updates)
    .where(and(eq(workflowNodes.id, params.nodeId), eq(workflowNodes.workflowId, params.id)))
    .returning();

  if (!updated) {
    return json({ error: 'Node not found' }, { status: 404 });
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
