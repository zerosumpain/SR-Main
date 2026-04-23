import { json, error, type RequestHandler } from '@sveltejs/kit';
import { runScrape } from '$lib/workflows/scraper/runner';
import { assertScraperServiceRequest } from '$lib/workflows/scraper/service-auth';
import type { ScrapeJob } from '$lib/workflows/scraper/types';

/**
 * Remote scrape execution endpoint — the other side of the
 * `SCRAPER_SERVICE_URL` proxy pattern. VPS-hosted workflows POST here
 * (targetting homeserv over Tailscale) so the headed browser work runs
 * from a residential IP.
 *
 * Auth: if `SCRAPER_SERVICE_TOKEN` is set, require it as a Bearer token.
 * Host guard: refuse to handle this endpoint from anywhere except
 *   homeserv. Otherwise a misconfigured proxy chain could loop back to
 *   the VPS and defeat the whole purpose.
 */
export const POST: RequestHandler = async ({ request }) => {
  assertScraperServiceRequest(request);

  const body = (await request.json().catch(() => ({}))) as Partial<ScrapeJob> & {
    workflowRunId?: string;
    _credential?: unknown;
  };
  if (!body.url || typeof body.url !== 'string') {
    throw error(400, 'url is required');
  }

  const result = await runScrape(body as unknown as Parameters<typeof runScrape>[0]);
  return json(result);
};
