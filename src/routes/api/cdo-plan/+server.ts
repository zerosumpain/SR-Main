import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCurrentPlan } from '$lib/cdo/orchestrator';

export const GET: RequestHandler = async () => {
	const plan = await getCurrentPlan();
	return json(plan);
};
