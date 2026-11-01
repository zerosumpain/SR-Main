// The open web as a wish list source: up to `SEARCHES_PER_DAY` searches per
// item per day, paced across its checks (`searchesAllowed`), each opening its
// readable results and taking every priced product on them — from JSON-LD,
// meta price tags, or a Shopify shop's catalogue JSON.
//
// Search goes through the site's search client, so it is ledgered under
// `purpose: 'wishlist'` on /admin/ops/tavily like every other search, and
// the balancer picks Tavily or Brave.

import { search } from '$lib/deepdive/web-search';
import { searchesAllowed, searchesToday } from '../due';
import { fetchPageScripts, fetchText, type FetchOptions, type PageScripts } from './fetch.server';
import { parseShopifyProducts, shopifyJsonUrl } from './shopify';
import { isReadableResult, listingsFromPage, nextQueries, SEARCH_SKIP_DOMAINS, searchQueries } from './search';
import type { Candidate, WishItem } from '../types';

/**
 * Results asked for per search: the most either provider returns in one
 * request, and a search costs the same whatever the count.
 */
const RESULTS_PER_SEARCH = 20;
/**
 * Results opened per search. Most carry no price we can read (a builder's
 * category page that lists links only, a review) — on 2026-11-01 the one shop
 * page with 24 listings was the fourth readable result — so open plenty; a
 * plain fetch is cheap.
 */
const PAGES_PER_SEARCH = 12;
/** Of those, how many may fall back to a residential scrape when turned away (each takes seconds on homeserv). */
const RESIDENTIAL_PER_SEARCH = 4;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export interface SearchDeps {
  search: typeof search;
  fetchPage: (url: string, opts: FetchOptions) => Promise<PageScripts>;
  /** A plain GET's body, null when it is not a 200. */
  fetchText: (url: string) => Promise<string | null>;
}

export interface SearchRun {
  candidates: Candidate[];
  errors: string[];
  searched: number;
}

/** Whether a Shopify shop prices in pounds, asked once per shop per run. */
async function shopIsGbp(origin: string, deps: SearchDeps, cache: Map<string, Promise<boolean>>): Promise<boolean> {
  let hit = cache.get(origin);
  if (!hit) {
    hit = deps.fetchText(`${origin}/cart.js`).then((t) => {
      try {
        return t !== null && (JSON.parse(t) as { currency?: unknown }).currency === 'GBP';
      } catch {
        return false;
      }
    });
    cache.set(origin, hit);
  }
  return hit;
}

/** One result's listings: a Shopify shop's catalogue JSON when the URL has that shape, else the page itself. */
async function readResult(url: string, residential: boolean, deps: SearchDeps, gbp: Map<string, Promise<boolean>>): Promise<Candidate[]> {
  const json = shopifyJsonUrl(url);
  if (json) {
    const origin = new URL(url).origin;
    const body = await deps.fetchText(json);
    if (body !== null) {
      const found = parseShopifyProducts(body, origin);
      if (found.length && (await shopIsGbp(origin, deps, gbp))) return found;
    }
  }
  return listingsFromPage(await deps.fetchPage(url, { residential }), url);
}

/**
 * Run this check's share of the item's searches. Records the spend on the item
 * (the caller saves it) before each search, so a search that throws still counts.
 */
export async function searchTheWeb(item: WishItem, now: Date, deps: Partial<SearchDeps> = {}): Promise<SearchRun> {
  const d: SearchDeps = {
    search: deps.search ?? search,
    fetchPage: deps.fetchPage ?? ((u, opts) => fetchPageScripts(u, undefined, opts)),
    fetchText: deps.fetchText ?? ((u) => fetchText(u)),
  };
  const gbp = new Map<string, Promise<boolean>>();
  const all = searchQueries(item.feeds);
  // The same query twice in one check would find the same pages.
  const queries = nextQueries(item, all, Math.min(searchesAllowed(item, now), all.length));
  const out: SearchRun = { candidates: [], errors: [], searched: 0 };
  const opened = new Set<string>();

  for (const q of queries) {
    const day = now.toISOString().slice(0, 10);
    item.searches = { day, count: searchesToday(item, now) + 1, cursor: (item.searches?.cursor ?? 0) + 1 };
    item.lastSearchedAt = now.toISOString();
    out.searched++;
    let urls: string[];
    try {
      const res = await d.search(q, { purpose: 'wishlist', maxResults: RESULTS_PER_SEARCH, excludeDomains: SEARCH_SKIP_DOMAINS });
      urls = res.results.map((r) => r.url).filter((u) => isReadableResult(u) && !opened.has(u)).slice(0, PAGES_PER_SEARCH);
    } catch (err) {
      out.errors.push(`search "${q}": ${errMsg(err)}`);
      continue;
    }
    for (const u of urls) opened.add(u);
    const pages = await Promise.allSettled(urls.map((u, i) => readResult(u, i < RESIDENTIAL_PER_SEARCH, d, gbp)));
    // An unreadable result (no priced Product, blocked) is not the search failing.
    for (const p of pages) if (p.status === 'fulfilled') out.candidates.push(...p.value);
  }
  return out;
}
