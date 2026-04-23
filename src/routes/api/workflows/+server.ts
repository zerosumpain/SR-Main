import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { allocateCanvasName } from '$lib/canvas/adapter.server';

export const GET: RequestHandler = async () => {
  const rows = await db.select().from(workflows).orderBy(desc(workflows.createdAt));
  return json(rows);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { name, description, nodes, edges } = body;

  if (!name || typeof name !== 'string') {
    return json({ error: 'name is required' }, { status: 400 });
  }

  // Every workflow must be addressable as a canvas. Coerce the supplied
  // name into a unique `canvas:<slug>` so the canvas index lists it; the
  // human-readable title is preserved in `description`.
  const { name: canvasName } = await allocateCanvasName(name);
  const [workflow] = await db.insert(workflows).values({
    name: canvasName,
    description: description || name,
  }).returning();

  if (Array.isArray(nodes) && nodes.length > 0) {
    await db.insert(workflowNodes).values(
      nodes.map((n: any) => ({
        id: n.id,
        workflowId: workflow.id,
        type: n.type,
        position: n.position || { x: 0, y: 0 },
        config: n.config || {},
        label: n.label || n.type,
      })),
    );
  }

  if (Array.isArray(edges) && edges.length > 0) {
    await db.insert(workflowEdges).values(
      edges.map((e: any) => ({
        id: e.id,
        workflowId: workflow.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        sourceHandle: e.sourceHandle || null,
        targetHandle: e.targetHandle || null,
      })),
    );
  }

  return json(workflow, { status: 201 });
};
