import { json, error, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import os from 'os';
import { runScrape } from '$lib/workflows/scraper/runner';
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
  if (os.hostname() !== 'homeserv' && !process.env.SCRAPER_ALLOW_NON_HOMESERV) {
    throw error(
      503,
      `/api/scraper/run is only served from homeserv (host='${os.hostname()}'). ` +
      `Running stealth scraping from the VPS defeats the residential-IP architecture.`,
    );
  }

  const expected = env.SCRAPER_SERVICE_TOKEN;
  if (expected) {
    const auth = request.headers.get('authorization') ?? '';
    const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (supplied !== expected) {
      throw error(401, 'Invalid or missing SCRAPER_SERVICE_TOKEN');
    }
  }

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
