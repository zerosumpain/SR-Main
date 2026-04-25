import { json } from '@sveltejs/kit';
import { getAutonomicBalance } from '$lib/health/services/autonomic-balance-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		return json(await getAutonomicBalance());
	} catch (err) {
		console.error('Failed to compute autonomic balance:', err);
		return json({ error: 'Failed to compute autonomic balance' }, { status: 500 });
	}
};
