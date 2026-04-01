import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startCdoResearch } from '$lib/cdo/orchestrator';

export const POST: RequestHandler = async () => {
	const planId = await startCdoResearch();
	return json({ planId }, { status: 201 });
};
