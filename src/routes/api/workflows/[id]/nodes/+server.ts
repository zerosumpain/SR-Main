import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const type = typeof body.type === 'string' ? body.type : '';
  const label = typeof body.label === 'string' && body.label ? body.label : type;
  const config =
    body.config && typeof body.config === 'object' ? (body.config as Record<string, unknown>) : {};
  const position =
    body.position && typeof body.position === 'object'
      ? { x: Number(body.position.x) || 0, y: Number(body.position.y) || 0 }
      : null;

  if (!type) return json({ error: 'type required' }, { status: 400 });
  if (!position) return json({ error: 'position required' }, { status: 400 });

  const [wf] = await db.select().from(workflows).where(eq(workflows.id, params.id));
  if (!wf) return json({ error: 'Workflow not found' }, { status: 404 });

  // Enforce one trigger per canvas.
  if (type === 'trigger') {
    const [existing] = await db
      .select()
      .from(workflowNodes)
      .where(and(eq(workflowNodes.workflowId, params.id), eq(workflowNodes.type, 'trigger')));
    if (existing) {
      return json(
        { error: 'This canvas already has a trigger node; delete it first.' },
        { status: 409 },
      );
    }
  }

  const [node] = await db
    .insert(workflowNodes)
    .values({ workflowId: params.id, type, label, position, config })
    .returning();

  return json({ node });
};
