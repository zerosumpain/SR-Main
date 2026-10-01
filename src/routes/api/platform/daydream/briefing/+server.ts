import { json, error } from '@sveltejs/kit';
import { invokeLaneFor } from '$lib/server/invoke-auth';
import { buildDaydreamBriefing } from '$lib/daydream/briefing';
import type { RequestHandler } from './$types';

/**
 * Yesterday's daydream section, for the morning briefing that SR-Workflows runs.
 *
 * The briefing node used to import `$lib/daydream/briefing` from its own copy of
 * this repository's daydream tree. That copy stopped moving on 26 Sep, so the
 * live briefing kept reading the retired appetite ledger while this one — the
 * only one that runs the D3 build notes — was never called. The daydream engine
 * lives here; so does the one function that summarises it.
 *
 * Same credential as the tool catalogue beside it. Read-only.
 */
export const GET: RequestHandler = async ({ request }) => {
	if (invokeLaneFor(request) === 'none') throw error(401, 'invalid token');
	return json(await buildDaydreamBriefing(new Date()));
};
