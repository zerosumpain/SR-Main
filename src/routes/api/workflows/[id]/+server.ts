import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { recordAuditBatch } from '$lib/canvas/audit';
import { diffWorkflowPatch } from '$lib/canvas/audit-diff';

export const GET: RequestHandler = async ({ params }) => {
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, params.id));
  if (!workflow) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, params.id));
  const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, params.id));

  return json({ ...workflow, nodes, edges });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const body = await request.json();
  const { name, description, nodes, edges } = body;

  const [existing] = await db.select().from(workflows).where(eq(workflows.id, params.id));
  if (!existing) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  const wfEntries = diffWorkflowPatch(
    { name: existing.name, description: existing.description },
    {
      name: typeof name === 'string' ? name : undefined,
      description: typeof description === 'string' ? description : undefined,
    },
  );
  if (wfEntries.length > 0) {
    await recordAuditBatch(
      wfEntries.map((e) => ({
        workflowId: params.id,
        entity: 'workflow' as const,
        entityId: params.id,
        action: e.action,
        details: e.details,
      })),
    );
  }

  await db.update(workflows).set({
    name: name ?? existing.name,
    description: description ?? existing.description,
    updatedAt: new Date(),
  }).where(eq(workflows.id, params.id));

  if (Array.isArray(nodes)) {
    await db.delete(workflowNodes).where(eq(workflowNodes.workflowId, params.id));
    if (nodes.length > 0) {
      await db.insert(workflowNodes).values(
        nodes.map((n: any) => ({
          id: n.id,
          workflowId: params.id,
          type: n.type,
          position: n.position || { x: 0, y: 0 },
          config: n.config || {},
          label: n.label || n.type,
        })),
      );
    }
  }

  if (Array.isArray(edges)) {
    await db.delete(workflowEdges).where(eq(workflowEdges.workflowId, params.id));
    if (edges.length > 0) {
      await db.insert(workflowEdges).values(
        edges.map((e: any) => ({
          id: e.id,
          workflowId: params.id,
          sourceNodeId: e.sourceNodeId,
          targetNodeId: e.targetNodeId,
          sourceHandle: e.sourceHandle || null,
          targetHandle: e.targetHandle || null,
        })),
      );
    }
  }

  return json({ success: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
  await db.delete(workflows).where(eq(workflows.id, params.id));
  return json({ success: true });
};
