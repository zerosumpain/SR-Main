/**
 * POST /api/scraper/node — retired 2026-10-02.
 *
 * This was the homeserv side of the `stealth-scrape` workflow node. SR-Workflows
 * retired that node type (saved graphs containing it are rejected before a run),
 * and Main no longer runs workflow nodes, so nothing calls this endpoint.
 *
 * The route stays as a stub so the public-route snapshot is unchanged until the
 * owner removes it from `.github/public-routes.txt` and `PUBLIC_PATHS`. It keeps
 * the homeserv + service-bearer check, so the surface it exposes does not widen.
 */
import { error, type RequestHandler } from '@sveltejs/kit';
import { assertScraperServiceRequest } from '$lib/scraper/service-auth';

export const POST: RequestHandler = async ({ request }) => {
  assertScraperServiceRequest(request);
  throw error(410, 'The stealth-scrape node was retired; this endpoint no longer runs it.');
};
