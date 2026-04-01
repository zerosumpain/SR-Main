import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getResearchActivity } from '$lib/cdo/orchestrator';

export const GET: RequestHandler = async () => {
	const activity = await getResearchActivity();
	return json(activity);
};
