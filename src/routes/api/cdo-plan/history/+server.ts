import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlanHistory } from '$lib/cdo/orchestrator';

export const GET: RequestHandler = async () => {
	const history = await getPlanHistory();
	return json(history);
};
