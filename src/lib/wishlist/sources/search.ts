// The open web as a wish list source — the PURE half: which queries a check
// runs, and which results are worth opening. The searching and reading are in
// `search.server.ts`.
//
// A result is opened only to read its schema.org `Product` JSON-LD — the same
// reader a tracked product page uses — so a listing's price always comes from
// the page that sells it, never from a search snippet ("was £999, now…").

import { isAllowedPricerunnerUrl } from './pricerunner';
import type { FeedRef, WishItem } from '../types';

/**
 * Sites not worth a result slot. Each costs a residential scrape to learn
 * nothing: bot management turns even the stealth scraper away (Currys, CCL,
 * Argos, Box, Ebuyer — 2026-10-31), the page carries no Product JSON-LD
 * (Amazon, eBay listings vary), it is already read as a feed (hotukdeals,
 * Reddit), or robots.txt says no (PriceSpy, camelcamelcamel).
 */
export const SEARCH_SKIP_DOMAINS = [
  'currys.co.uk', 'cclonline.com', 'argos.co.uk', 'box.co.uk', 'ebuyer.com',
  'amazon.co.uk', 'amazon.com', 'ebay.co.uk', 'ebay.com',
  'hotukdeals.com', 'reddit.com', 'pricespy.co.uk', 'camelcamelcamel.com',
  'youtube.com', 'facebook.com', 'tiktok.com', 'instagram.com', 'x.com', 'twitter.com',
];

const onDomain = (host: string, d: string) => host === d || host.endsWith(`.${d}`);

/** True for a result URL worth opening for a price. */
export function isReadableResult(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (SEARCH_SKIP_DOMAINS.some((d) => onDomain(host, d))) return false;
  // PriceRunner's search and filtered pages are disallowed; its product pages are not.
  if (onDomain(host, 'pricerunner.com')) return isAllowedPricerunnerUrl(raw);
  return true;
}

/** An item's search queries (the old PriceRunner-only `tavily` feed counts as one). */
export function searchQueries(feeds: FeedRef[]): string[] {
  return [...new Set(feeds.filter((f) => f.source === 'search' || f.source === 'tavily').map((f) => f.value))];
}

/** The next `n` queries in rotation, so every query gets its turn across the days. */
export function nextQueries(item: Pick<WishItem, 'searches'>, queries: string[], n: number): string[] {
  if (!queries.length || n <= 0) return [];
  const start = item.searches?.cursor ?? 0;
  return Array.from({ length: n }, (_, i) => queries[(start + i) % queries.length]);
}
