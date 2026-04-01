import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startCdoResearch, getCurrentPlan } from '$lib/cdo/orchestrator';

export const POST: RequestHandler = async () => {
	// Get previous plan for re-synthesis
	const previous = await getCurrentPlan();
	const previousPlanId = previous?.status === 'complete' ? previous.id : undefined;

	const planId = await startCdoResearch(previousPlanId);
	return json({ planId }, { status: 201 });
};
