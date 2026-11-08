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
import { extractPriceMeta, type PriceMeta } from './search';

const DIRECT_TIMEOUT_MS = 20_000;
const MAX_HTML_CHARS = 5_000_000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export interface PageScripts {
  payload: string | null;
  ld: string[];
  /** The price in the page's meta tags — for a page with no JSON-LD Product. */
  meta: PriceMeta | null;
  via: 'direct' | 'residential';
}

export interface FetchOptions {
  /** false: give up when the plain fetch fails, rather than spend a residential scrape. */
  residential?: boolean;
}

export interface FetchDeps {
  fetchFn: typeof fetch;
  scrape: typeof runScrape;
}

const DEFAULT_DEPS: FetchDeps = { fetchFn: fetch, scrape: runScrape };

export async function fetchPageScripts(url: string, deps: FetchDeps = DEFAULT_DEPS, opts: FetchOptions = {}): Promise<PageScripts> {
  try {
    const res = await deps.fetchFn(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-GB,en;q=0.9' },
      signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
    });
    if (res.status === 200) {
      const html = (await res.text()).slice(0, MAX_HTML_CHARS);
      const payload = extractInitialPayload(html);
      const ld = extractLdBlocks(html);
      const meta = extractPriceMeta(html);
      if (payload || ld.length || meta) return { payload, ld, meta, via: 'direct' };
    }
  } catch {
    // Timeout or network — the residential path is the answer to both.
  }
  if (opts.residential === false) throw new Error(`could not read ${new URL(url).hostname} directly`);

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
      { field: 'amount', selector: 'meta[property="product:price:amount"], meta[property="og:price:amount"], meta[itemprop="price"]', attr: 'content' },
      { field: 'currency', selector: 'meta[property="product:price:currency"], meta[property="og:price:currency"], meta[itemprop="priceCurrency"]', attr: 'content' },
      { field: 'title', selector: 'meta[property="og:title"]', attr: 'content' },
      { field: 'description', selector: 'meta[property="og:description"], meta[name="description"]', attr: 'content' },
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
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const amount = str(fields.amount);
  const meta = amount ? { amount, currency: str(fields.currency), title: str(fields.title), description: str(fields.description) } : null;
  return { payload, ld, meta, via: 'residential' };
}

/**
 * A Scan category page's product cards, through the residential scraper only:
 * Scan turns a plain fetch away from every host, so trying it first would cost
 * a timeout for nothing. The cards come back as inner HTML for `scan.ts` to read.
 */
export async function fetchScanCards(url: string, deps: Pick<FetchDeps, 'scrape'> = DEFAULT_DEPS): Promise<string[]> {
  const job = {
    url,
    profile: 'wishlist',
    waitFor: { type: 'networkidle' as const },
    extract: [{ field: 'cards', selector: 'li.product', attr: 'html', multi: true }],
    screenshotOnFailure: false,
  };
  let result = await deps.scrape(job);
  if (!result.success && result.needsInteractive) result = await deps.scrape(job);
  if (!result.success) {
    const why = result.challengeReason ? `blocked (${result.challengeReason})` : (result.error ?? 'scrape failed');
    throw new Error(`could not read scan.co.uk: ${why}`);
  }
  const cards = result.pages?.[0]?.fields?.cards;
  return Array.isArray(cards) ? cards.filter((s): s is string => typeof s === 'string') : [];
}

/**
 * A plain GET's body, or null for anything but a 200 — for the JSON endpoints
 * (`shopify.ts`) that answer a plain request or not at all.
 */
export async function fetchText(url: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchFn(url, {
      headers: { 'user-agent': UA, accept: 'application/json,text/plain;q=0.9,*/*;q=0.5', 'accept-language': 'en-GB,en;q=0.9' },
      signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
    });
    return res.status === 200 ? (await res.text()).slice(0, MAX_HTML_CHARS) : null;
  } catch {
    return null;
  }
}
