/**
 * /api/scraper/script — retired 2026-10-02.
 *
 * Saved Playwright scripts only ever drove the `stealth-scrape` workflow node
 * (its panel's "Script status" section and the VPS→homeserv script dispatch).
 * SR-Workflows retired that node, so nothing reads, writes or runs these scripts.
 * Script files already on homeserv are left on disk untouched.
 *
 * The route stays as a stub so the public-route snapshot is unchanged until the
 * owner removes it from `.github/public-routes.txt` and the hook's homeserv
 * bypass. Every method still requires the owner or the scraper service bearer on
 * homeserv before answering 410, so the stub exposes nothing new.
 */
import { error, type RequestHandler } from '@sveltejs/kit';
import { assertScraperServiceRequest } from '$lib/scraper/service-auth';
import { isOwnerRequest } from '$lib/server/owner';

const GONE = 'Saved scraper scripts were retired with the stealth-scrape node.';

const retired: RequestHandler = async ({ request, locals, getClientAddress }) => {
  if (!(await isOwnerRequest({ locals, getClientAddress }))) assertScraperServiceRequest(request);
  throw error(410, GONE);
};

export const GET = retired;
export const POST = retired;
export const DELETE = retired;
