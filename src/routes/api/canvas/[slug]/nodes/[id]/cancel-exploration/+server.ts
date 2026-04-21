import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelExplorations, quickAnswers } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { executeSiteTool } from '$lib/workflows/site-tools/executor';
import { requestStop } from '$lib/quickanswer/worker';

export const POST: RequestHandler = async ({ params }) => {
  const [row] = await db
    .select()
    .from(intelExplorations)
    .where(eq(intelExplorations.nodeId, params.id))
    .limit(1);
  if (!row) throw error(404, 'No active exploration for this node');

  if (row.engine === 'deep') {
    try {
      await executeSiteTool('research_control', { id: row.sessionId, action: 'stop' });
    } catch (err) {
      console.error('[cancel-exploration] deep stop failed:', err);
    }
  } else {
    requestStop(row.sessionId);
    await db
      .update(quickAnswers)
      .set({ status: 'failed', errorMessage: 'Cancelled', completedAt: new Date() })
      .where(eq(quickAnswers.id, row.sessionId))
      .catch(console.error);
  }

  await db
    .update(intelExplorations)
    .set({ status: 'cancelled', completedAt: new Date() })
    .where(eq(intelExplorations.id, row.id));

  return json({ cancelled: true });
};
