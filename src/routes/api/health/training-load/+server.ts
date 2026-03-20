import { json } from '@sveltejs/kit';
import { getTrainingLoad } from '$lib/health/training-load-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		const result = await getTrainingLoad();
		return json(result);
	} catch (err) {
		console.error('Failed to compute training load:', err);
		return json({ error: 'Failed to compute training load' }, { status: 500 });
	}
};
