import type { PageServerLoad } from './$types';
import { getCurrentPlan, getResearchActivity } from '$lib/cdo/orchestrator';

export const load: PageServerLoad = async () => {
	const [plan, activity] = await Promise.all([getCurrentPlan(), getResearchActivity()]);
	return { plan, activity };
};
