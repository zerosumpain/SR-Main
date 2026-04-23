import { env } from '$env/dynamic/private';
import os from 'os';
import { error } from '@sveltejs/kit';

/**
 * Service-to-service auth for scraper/interactive proxy endpoints.
 *
 * Enforces two invariants before the handler runs:
 *  1. The serving host MUST be homeserv (prevents a misconfigured proxy
 *     chain from looping back to the VPS and defeating the residential-IP
 *     architecture).
 *  2. If `SCRAPER_SERVICE_TOKEN` is set, require a matching
 *     `Authorization: Bearer <token>` header.
 *
 * Throws sveltekit errors (401/503) on failure. Call at the top of every
 * route handler in /api/scraper/run and /api/scraper/interactive*.
 */
export function assertScraperServiceRequest(request: Request): void {
  if (os.hostname() !== 'homeserv' && !process.env.SCRAPER_ALLOW_NON_HOMESERV) {
    throw error(
      503,
      `Scraper service endpoints only served from homeserv (host='${os.hostname()}').`,
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
}
