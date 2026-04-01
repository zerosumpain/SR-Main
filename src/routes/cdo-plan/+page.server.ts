import type { PageServerLoad } from './$types';
import { getCurrentPlan, getPlanHistory } from '$lib/cdo/orchestrator';

export const load: PageServerLoad = async () => {
	const [plan, history] = await Promise.all([getCurrentPlan(), getPlanHistory()]);
	return { plan, history };
};
