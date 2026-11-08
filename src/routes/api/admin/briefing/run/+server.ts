import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows } from '$lib/db/schema';
import { BRIEFING_WORKFLOW_NAME } from '$lib/briefing/types';
import { startRun } from '$lib/workflows-client/start-run';

// Owner-gated by hooks. Starts the morning-briefing workflow now, outside its
// schedule. SR-Workflows runs it and writes the result into `briefings`.
export const POST: RequestHandler = async () => {
  const [wf] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(eq(workflows.name, BRIEFING_WORKFLOW_NAME))
    .limit(1);
  if (!wf) return json({ error: 'the briefing workflow is not set up' }, { status: 404 });
  try {
    const started = await startRun({ workflowId: wf.id, trigger: 'manual', label: 'briefing' });
    if (!started) return json({ error: 'the briefing workflow is not set up' }, { status: 404 });
    return json({ ok: true, runId: started.runId });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'run failed' }, { status: 502 });
  }
};
