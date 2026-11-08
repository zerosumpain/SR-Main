import { json, error } from '@sveltejs/kit';
import { invokeLaneFor } from '$lib/server/invoke-auth';
import { buildBriefingContext } from '$lib/briefing/context.server';
import type { RequestHandler } from './$types';

/**
 * Today's trip (or the next one) and the family's overnight picture, for the
 * morning briefing that SR-Workflows composes. Its database role cannot read
 * Main's trip and family tables, so Main summarises them here.
 *
 * `?tz=Europe/London` (optional) sets the day. Same credential as
 * /api/platform/daydream/briefing. Read-only; missing data is empty, never an
 * error.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	if (invokeLaneFor(request) === 'none') throw error(401, 'invalid token');
	return json(await buildBriefingContext(new Date(), url.searchParams.get('tz')));
};
