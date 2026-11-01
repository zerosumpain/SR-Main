// The open web as a wish list source: up to `SEARCHES_PER_DAY` searches per
// item per day, paced across its checks (`searchesAllowed`), each opening its
// first few readable results and taking every priced product on them.
//
// Search goes through the site's search client, so it is ledgered under
// `purpose: 'wishlist'` on /admin/ops/tavily like every other search, and
// the balancer picks Tavily or Brave.

import { search } from '$lib/deepdive/web-search';
import { searchesAllowed, searchesToday } from '../due';
import { fetchPageScripts, type PageScripts } from './fetch.server';
import { isReadableResult, listingsFromPage, nextQueries, SEARCH_SKIP_DOMAINS, searchQueries } from './search';
import type { Candidate, WishItem } from '../types';

/**
 * Results opened per search. Many results carry no priced products (a
 * builder's category page that lists links only, a review) — on 2026-11-01 the
 * one shop page with 24 listings was the fourth readable result — and a
 * blocked page costs a residential scrape, so five, read in parallel.
 */
const PAGES_PER_SEARCH = 5;
const RESULTS_PER_SEARCH = 8;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export interface SearchDeps {
  search: typeof search;
  fetchPage: (url: string) => Promise<PageScripts>;
}

export interface SearchRun {
  candidates: Candidate[];
  errors: string[];
  searched: number;
}

/**
 * Run this check's share of the item's searches. Records the spend on the item
 * (the caller saves it) before each search, so a search that throws still counts.
 */
export async function searchTheWeb(item: WishItem, now: Date, deps: Partial<SearchDeps> = {}): Promise<SearchRun> {
  const run = deps.search ?? search;
  const fetchPage = deps.fetchPage ?? ((u: string) => fetchPageScripts(u));
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
      const res = await run(q, { purpose: 'wishlist', maxResults: RESULTS_PER_SEARCH, excludeDomains: SEARCH_SKIP_DOMAINS });
      urls = res.results.map((r) => r.url).filter((u) => isReadableResult(u) && !opened.has(u)).slice(0, PAGES_PER_SEARCH);
    } catch (err) {
      out.errors.push(`search "${q}": ${errMsg(err)}`);
      continue;
    }
    for (const u of urls) opened.add(u);
    const pages = await Promise.allSettled(urls.map(async (u) => listingsFromPage(await fetchPage(u), u)));
    // An unreadable result (no priced Product, blocked) is not the search failing.
    for (const p of pages) if (p.status === 'fulfilled') out.candidates.push(...p.value);
  }
  return out;
}
