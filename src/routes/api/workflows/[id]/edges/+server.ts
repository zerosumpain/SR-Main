import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowEdges, workflowNodes } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { recordAudit } from '$lib/canvas/audit';

function isStatsType(type: string): boolean {
  return type.startsWith('stats-');
}

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

  // Reject edges touching display-only stats nodes.
  if (both.some((n) => isStatsType(n.type))) {
    return json(
      { error: 'Stats nodes are display-only and cannot be connected.' },
      { status: 400 },
    );
  }

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
    .values({ workflowId: params.id, sourceNodeId, targetNodeId })
    .returning();

  const src = both.find((n) => n.id === sourceNodeId);
  const tgt = both.find((n) => n.id === targetNodeId);
  await recordAudit({
    workflowId: params.id,
    entity: 'edge',
    entityId: edge.id,
    action: 'create',
    details: {
      from: sourceNodeId,
      to: targetNodeId,
      fromLabel: src?.label ?? null,
      toLabel: tgt?.label ?? null,
    },
  });

  return json({ edge });
};

export const DELETE: RequestHandler = async ({ params, url }) => {
  const edgeId = url.searchParams.get('id');
  const sourceNodeId = url.searchParams.get('source');
  const targetNodeId = url.searchParams.get('target');

  async function auditRemoved(
    ids: string[],
    edges: Array<{ sourceNodeId: string; targetNodeId: string }>,
  ) {
    if (ids.length === 0) return;
    const nodeIds = Array.from(new Set(edges.flatMap((e) => [e.sourceNodeId, e.targetNodeId])));
    const nodes = nodeIds.length
      ? await db
          .select({ id: workflowNodes.id, label: workflowNodes.label })
          .from(workflowNodes)
          .where(inArray(workflowNodes.id, nodeIds))
      : [];
    const labelById = new Map(nodes.map((n) => [n.id, n.label]));
    for (let i = 0; i < ids.length; i++) {
      const e = edges[i];
      await recordAudit({
        workflowId: params.id,
        entity: 'edge',
        entityId: ids[i],
        action: 'delete',
        details: {
          from: e.sourceNodeId,
          to: e.targetNodeId,
          fromLabel: labelById.get(e.sourceNodeId) ?? null,
          toLabel: labelById.get(e.targetNodeId) ?? null,
        },
      });
    }
  }

  if (edgeId) {
    const [removed] = await db
      .delete(workflowEdges)
      .where(and(eq(workflowEdges.id, edgeId), eq(workflowEdges.workflowId, params.id)))
      .returning();
    if (!removed) return json({ error: 'Edge not found' }, { status: 404 });
    await auditRemoved(
      [removed.id],
      [{ sourceNodeId: removed.sourceNodeId, targetNodeId: removed.targetNodeId }],
    );
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
    await auditRemoved(
      removed.map((r) => r.id),
      removed.map((r) => ({ sourceNodeId: r.sourceNodeId, targetNodeId: r.targetNodeId })),
    );
    return json({ deleted: removed.map((r) => r.id) });
  }

  return json({ error: 'Provide ?id=… or ?source=&target=' }, { status: 400 });
};
