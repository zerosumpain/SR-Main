import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowRuns, workflowNodes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { UndoEntry } from '$lib/workflows/types';

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json();
  const { undoId } = body;

  if (!undoId) {
    return json({ error: 'undoId is required' }, { status: 400 });
  }

  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, params.runId));
  if (!run) {
    return json({ error: 'Run not found' }, { status: 404 });
  }

  const healingHistory = (run.healingHistory || []) as UndoEntry[];
  const entry = healingHistory.find(e => e.id === undoId);

  if (!entry) {
    return json({ error: 'Undo entry not found' }, { status: 404 });
  }

  // Restore original config
  await db.update(workflowNodes).set({
    config: entry.originalConfig,
  }).where(eq(workflowNodes.id, entry.nodeId));

  return json({ success: true, nodeId: entry.nodeId, restoredConfig: entry.originalConfig });
};
