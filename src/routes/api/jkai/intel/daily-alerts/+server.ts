import { json, error } from '@sveltejs/kit';
import { hasJkaiServiceToken } from '$lib/server/invoke-auth';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';
import type { RequestHandler } from './$types';

/**
 * The undismissed alerts of the last 24 hours, for the /jkai landing page.
 *
 * `loadDailyAlerts` already answers `{status: 'failed', …}` rather than
 * throwing when the query fails — the landing page shows a line saying so
 * instead of losing the panel. That contract is preserved across the wire: this
 * returns 200 with the failed summary rather than a 500, because a caller that
 * has to distinguish "no alerts" from "could not ask" already can, by reading
 * `status`.
 */
export const GET: RequestHandler = async (event) => {
	const { request, locals } = event;
	const session = await locals.auth();
	if (!hasJkaiServiceToken(request) && !session?.user) throw error(401, 'Unauthorized');

	const { loadDailyAlerts } = await import('$lib/jkai/intel/daily-alerts.server');
	// Whose digest: the reader's scope, never the owner default.
	return json(await loadDailyAlerts(undefined, await resolveRequestScope(event)));
};
