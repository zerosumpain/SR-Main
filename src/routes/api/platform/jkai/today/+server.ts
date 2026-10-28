import { json, error } from '@sveltejs/kit';
import { invokeLaneFor } from '$lib/server/invoke-auth';
import { getOwnerEmails } from '$lib/server/access';
import { loadToday } from '$lib/today/today.server';
import { DESK_TODAY_SECTIONS, parseSections } from '$lib/today/today';
import type { RequestHandler } from './$types';

/**
 * Today for the jkai desk in SR-Jkai-Core: what needs the owner (double-checks
 * waiting for his OK, reports back, deliveries blocked on him), the latest
 * briefing, connections needing attention and his last thread.
 *
 * Core's database role cannot read Main's daydream commissions or development
 * deliveries, so Main summarises them here — the same reason
 * /api/platform/briefing/context exists — and no new GRANT is needed.
 *
 * OWNER ONLY. The service credential is the owner's lane: Core calls this on
 * his behalf, and Core gates the caller (`chatAccess(event).level === 'owner'`)
 * before it asks, so a member's session or phone never reaches it. Read-only.
 *
 * `?sections=needsYou,briefing` narrows it (unknown names are ignored); each
 * section is null when it could not be read, never an error for the rest.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	if (invokeLaneFor(request) === 'none') throw error(401, 'invalid token');
	const ownerKey = getOwnerEmails()[0] ?? 'owner';
	const today = await loadToday({ ownerKey, sections: parseSections(url.searchParams.get('sections'), DESK_TODAY_SECTIONS) });
	return json(today, { headers: { 'cache-control': 'private, no-store' } });
};
