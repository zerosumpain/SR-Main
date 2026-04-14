import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowRuns, workflowSchedules } from '$lib/db/schema';
import { eq, sql, gte } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
	// Count runs by status (last 24h)
	const since = new Date(Date.now() - 86400000);

	const runCounts = await db
		.select({
			status: workflowRuns.status,
			count: sql<number>`count(*)::int`
		})
		.from(workflowRuns)
		.where(gte(workflowRuns.startedAt, since))
		.groupBy(workflowRuns.status);

	// Count enabled schedules
	const [scheduleCount] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(workflowSchedules)
		.where(eq(workflowSchedules.enabled, true));

	const metrics: Record<string, number> = {
		scheduled: scheduleCount?.count ?? 0,
		running: 0,
		completed: 0,
		failed: 0,
		pending: 0
	};

	for (const row of runCounts) {
		if (row.status in metrics) {
			metrics[row.status] = row.count;
		}
	}

	return json(metrics);
};
