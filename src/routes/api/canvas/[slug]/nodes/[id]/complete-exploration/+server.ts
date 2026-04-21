import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelExplorations, workflowNodes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

type Body = {
  report?: string;
  sources?: unknown[];
  durationMs?: number;
};

export const POST: RequestHandler = async ({ params, request }) => {
  const body = (await request.json().catch(() => ({}))) as Body;

  const [row] = await db
    .select()
    .from(intelExplorations)
    .where(eq(intelExplorations.nodeId, params.id))
    .limit(1);
  if (!row) throw error(404, 'No exploration for this node');

  await db
    .update(intelExplorations)
    .set({ status: 'complete', completedAt: new Date() })
    .where(eq(intelExplorations.id, row.id));

  // Persist result to the node's config so reloads show the completed report.
  const [node] = await db.select().from(workflowNodes).where(eq(workflowNodes.id, params.id)).limit(1);
  if (node) {
    const nextConfig = {
      ...(node.config as Record<string, unknown>),
      completedReport: body.report ?? '',
      completedSources: body.sources ?? [],
      completedDurationMs: body.durationMs ?? null,
      completedAt: new Date().toISOString(),
    };
    await db.update(workflowNodes).set({ config: nextConfig }).where(eq(workflowNodes.id, params.id));
  }

  return json({ completed: true });
};
