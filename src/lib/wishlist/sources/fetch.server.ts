// Fetching a product or category page for the wish list: plainly first, then
// through the residential scraper when the plain fetch is turned away.
//
// From the VPS, PriceRunner answers a plain fetch with an empty 202 (a bot
// check) and many retailers 403; the same request from homeserv's home
// connection gets the page. `runScrape` already forwards to homeserv over the
// tailnet (`SCRAPER_SERVICE_URL`), so this reuses it rather than standing up a
// second residential path. Only the two script blocks we parse come back —
// never the whole page — so a 1.5 MB product page crosses the tailnet as a few
// kilobytes of JSON.

import { runScrape } from '$lib/scraper/runner';
import { extractInitialPayload, extractLdBlocks } from './pricerunner';

const DIRECT_TIMEOUT_MS = 20_000;
const MAX_HTML_CHARS = 5_000_000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export interface PageScripts {
  payload: string | null;
  ld: string[];
  via: 'direct' | 'residential';
}

export interface FetchDeps {
  fetchFn: typeof fetch;
  scrape: typeof runScrape;
}

const DEFAULT_DEPS: FetchDeps = { fetchFn: fetch, scrape: runScrape };

export async function fetchPageScripts(url: string, deps: FetchDeps = DEFAULT_DEPS): Promise<PageScripts> {
  try {
    const res = await deps.fetchFn(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-GB,en;q=0.9' },
      signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
    });
    if (res.status === 200) {
      const html = (await res.text()).slice(0, MAX_HTML_CHARS);
      const payload = extractInitialPayload(html);
      const ld = extractLdBlocks(html);
      if (payload || ld.length) return { payload, ld, via: 'direct' };
    }
  } catch {
    // Timeout or network — the residential path is the answer to both.
  }

  const job = {
    url,
    profile: 'wishlist',
    // networkidle, not a fixed pause: PriceRunner serves a JS challenge first,
    // and a 1.5 s wait read the challenge page (needsInteractive) where
    // networkidle reads the product (checked 2026-10-31).
    waitFor: { type: 'networkidle' as const },
    extract: [
      { field: 'payload', selector: 'script#initial_payload', attr: 'html' },
      { field: 'ld', selector: 'script[type="application/ld+json"]', attr: 'html', multi: true },
    ],
    screenshotOnFailure: false,
  };
  let result = await deps.scrape(job);
  // The scraper reads PriceRunner's cookie banner as a challenge on some loads
  // (`challengeReason: 'cookie-consent'`); the same job a moment later reads
  // the page. Two of four failed that way in testing, every retry succeeded.
  if (!result.success && result.needsInteractive) result = await deps.scrape(job);
  if (!result.success) {
    const why = result.challengeReason ? `blocked (${result.challengeReason})` : (result.error ?? 'scrape failed');
    throw new Error(`could not read ${new URL(url).hostname}: ${why}`);
  }
  const fields = result.pages?.[0]?.fields ?? {};
  const payload = typeof fields.payload === 'string' && fields.payload ? fields.payload : null;
  const ld = Array.isArray(fields.ld) ? fields.ld.filter((s): s is string => typeof s === 'string') : typeof fields.ld === 'string' ? [fields.ld] : [];
  return { payload, ld, via: 'residential' };
}
