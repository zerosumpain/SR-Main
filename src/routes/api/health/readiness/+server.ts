import { json } from '@sveltejs/kit';
import { getReadiness } from '$lib/health/readiness-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		const result = await getReadiness();
		return json(result);
	} catch (err) {
		console.error('Failed to compute readiness:', err);
		return json({ error: 'Failed to compute readiness' }, { status: 500 });
	}
};
