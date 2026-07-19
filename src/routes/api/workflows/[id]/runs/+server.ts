import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowRuns } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';

/** List a workflow's runs, newest first. `?limit=` caps the page (default 50,
 *  max 200) — long-lived scheduled workflows accumulate thousands of rows. */
export const GET: RequestHandler = async ({ params, url }) => {
  const rawLimit = Number(url.searchParams.get('limit') ?? 50);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 50, 1), 200);
  const runs = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, params.id))
    .orderBy(desc(workflowRuns.startedAt))
    .limit(limit);

  return json(runs);
};
