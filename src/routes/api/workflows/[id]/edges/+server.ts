import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowEdges, workflowNodes } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const sourceNodeId = body.sourceNodeId as string | undefined;
  const targetNodeId = body.targetNodeId as string | undefined;
  if (!sourceNodeId || !targetNodeId) {
    return json({ error: 'sourceNodeId and targetNodeId required' }, { status: 400 });
  }
  if (sourceNodeId === targetNodeId) {
    return json({ error: 'A node cannot pipe to itself' }, { status: 400 });
  }

  // Both endpoints must belong to this workflow
  const both = await db
    .select()
    .from(workflowNodes)
    .where(
      and(
        eq(workflowNodes.workflowId, params.id),
        inArray(workflowNodes.id, [sourceNodeId, targetNodeId]),
      ),
    );
  if (both.length !== 2) {
    return json({ error: 'Source or target node not in this workflow' }, { status: 404 });
  }

  // Dedupe — if edge already exists, return it
  const [existing] = await db
    .select()
    .from(workflowEdges)
    .where(
      and(
        eq(workflowEdges.workflowId, params.id),
        eq(workflowEdges.sourceNodeId, sourceNodeId),
        eq(workflowEdges.targetNodeId, targetNodeId),
      ),
    );
  if (existing) return json({ edge: existing });

  const [edge] = await db
    .insert(workflowEdges)
    .values({
      workflowId: params.id,
      sourceNodeId,
      targetNodeId,
    })
    .returning();
  return json({ edge });
};

export const DELETE: RequestHandler = async ({ params, url }) => {
  const edgeId = url.searchParams.get('id');
  const sourceNodeId = url.searchParams.get('source');
  const targetNodeId = url.searchParams.get('target');

  if (edgeId) {
    const [removed] = await db
      .delete(workflowEdges)
      .where(and(eq(workflowEdges.id, edgeId), eq(workflowEdges.workflowId, params.id)))
      .returning();
    if (!removed) return json({ error: 'Edge not found' }, { status: 404 });
    return json({ deleted: removed.id });
  }

  if (sourceNodeId && targetNodeId) {
    const removed = await db
      .delete(workflowEdges)
      .where(
        and(
          eq(workflowEdges.workflowId, params.id),
          eq(workflowEdges.sourceNodeId, sourceNodeId),
          eq(workflowEdges.targetNodeId, targetNodeId),
        ),
      )
      .returning();
    return json({ deleted: removed.map((r) => r.id) });
  }

  return json({ error: 'Provide ?id=… or ?source=&target=' }, { status: 400 });
};
