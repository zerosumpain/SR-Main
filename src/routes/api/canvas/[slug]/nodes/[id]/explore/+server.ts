import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowNodes, workflowEdges, workflows, intelExplorations, quickAnswers } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { startQuickAnswer } from '$lib/quickanswer/worker';

type Engine = 'deep' | 'quick';

export const POST: RequestHandler = async ({ params, request }) => {
  const body = (await request.json().catch(() => null)) as { engine?: Engine } | null;
  const engine: Engine = body?.engine === 'quick' ? 'quick' : 'deep';

  const [wf] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(eq(workflows.name, `canvas:${params.slug}`))
    .limit(1);
  if (!wf) throw error(404, 'Canvas not found');

  // Load the parent intelligence node.
  const [parent] = await db
    .select()
    .from(workflowNodes)
    .where(eq(workflowNodes.id, params.id))
    .limit(1);
  if (!parent) throw error(404, 'Node not found');
  if (parent.type !== 'intelligence') throw error(400, 'Only intelligence nodes can explore');

  const parentConfig = (parent.config ?? {}) as Record<string, unknown>;
  const topic = typeof parentConfig.query === 'string' ? (parentConfig.query as string) : '';
  if (!topic.trim()) throw error(400, 'Intelligence node has no query to explore');

  const facets = (parentConfig.facets ?? {}) as Record<string, unknown>;
  const goals: string[] = [];
  if (Array.isArray(facets.entityTypes) && facets.entityTypes.length > 0) {
    goals.push(`Focus on: ${(facets.entityTypes as string[]).join(', ')}`);
  }
  if (facets.timeRange) {
    const tr = facets.timeRange as { from: string; to: string };
    goals.push(`Restrict to ${tr.from} – ${tr.to}`);
  }

  // Commission the session.
  let sessionId: string;
  let streamUrl: string;
  if (engine === 'deep') {
    const result = (await executeSiteTool('research_start', { topic, goals })) as {
      success: boolean;
      data?: { id?: string };
      error?: string;
    };
    if (!result.success || !result.data?.id) {
      throw error(500, `Deep research failed to start: ${result.error ?? 'unknown'}`);
    }
    sessionId = result.data.id;
    streamUrl = `/api/deepdive/${sessionId}/stream`;
  } else {
    const [row] = await db
      .insert(quickAnswers)
      .values({ topic, goals, status: 'pending' })
      .returning({ id: quickAnswers.id });
    sessionId = row.id;
    streamUrl = `/quickanswer/${sessionId}/stream`;
    startQuickAnswer(sessionId).catch((err) =>
      console.error('[explore] quick-answer start failed:', err),
    );
  }

  // Position the child node: below + right of the parent.
  const parentPos = (parent.position ?? { x: 0, y: 0 }) as { x: number; y: number };
  const position = { x: parentPos.x + 140, y: parentPos.y + 120 };

  const [newNode] = await db
    .insert(workflowNodes)
    .values({
      workflowId: wf.id,
      type: 'research-result',
      position,
      config: { engine, sessionId, topic, parentNodeId: parent.id, size: { w: 340, h: 360 } },
      label: engine === 'deep' ? 'Deep research' : 'Quick research',
    })
    .returning();

  const [newEdge] = await db
    .insert(workflowEdges)
    .values({
      workflowId: wf.id,
      sourceNodeId: parent.id,
      targetNodeId: newNode.id,
    })
    .returning();

  await db.insert(intelExplorations).values({
    workflowId: wf.id,
    nodeId: newNode.id,
    parentNodeId: parent.id,
    engine,
    sessionId,
    status: 'running',
    topic,
  });

  return json({ node: newNode, edge: newEdge, streamUrl });
};
