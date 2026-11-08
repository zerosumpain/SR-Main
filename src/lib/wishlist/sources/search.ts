// The open web as a wish list source — the PURE half: which queries a check
// runs, and which results are worth opening. The searching and reading are in
// `search.server.ts`.
//
// A result is opened only to read the schema.org `Product`s in its JSON-LD,
// so a listing's price always comes from the page that sells it, never from a
// search snippet ("was £999, now…"). Most results are category pages, not
// one product (checked 2026-11-01: LaptopsDirect's RTX 5060 page is a
// CollectionPage whose ItemList holds 24 priced Products), so every priced
// Product on the page is a listing.

import { amountToPence } from '../specs';
import { availability, isAllowedPricerunnerUrl, parseCategoryPayload, parseProductLd } from './pricerunner';
import type { Candidate, FeedRef, WishItem } from '../types';

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

const MAX_LISTINGS_PER_PAGE = 60;

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£' };

/**
 * HTML entities in text a page gave us: AWD-IT's og:title spells every space
 * `&#x20;` ("RTX&#x20;5060" names no GPU the matcher knows), and JSON-LD
 * descriptions carry `&amp;`.
 */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

/** A page's price as its meta tags give it (Open Graph / Facebook product tags, or microdata). */
export interface PriceMeta {
  amount: string;
  currency: string | null;
  title: string | null;
  /** og:description or the meta description — where a shop that has no JSON-LD puts the specs, if anywhere. */
  description?: string | null;
}

const ATTR = /([a-z:-]+)\s*=\s*("([^"]*)"|'([^']*)')/gi;

/**
 * `product:price:amount` / `og:price:amount` / `itemprop="price"` and their
 * currency, plus `og:title`. A shop theme with no JSON-LD Product usually has
 * these (AWD-IT's RTX 5060 Ti PC at £1,099.99 had only these, 2026-11-01).
 */
export function extractPriceMeta(html: string): PriceMeta | null {
  const tags: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs: Record<string, string> = {};
    for (const a of m[0].matchAll(ATTR)) attrs[a[1].toLowerCase()] = a[3] ?? a[4] ?? '';
    const name = (attrs.property ?? attrs.itemprop ?? attrs.name ?? '').toLowerCase();
    if (name && attrs.content !== undefined && !(name in tags)) tags[name] = decodeEntities(attrs.content).trim();
  }
  const amount = tags['product:price:amount'] || tags['og:price:amount'] || tags.price;
  if (!amount) return null;
  return {
    amount,
    currency: tags['product:price:currency'] || tags['og:price:currency'] || tags.pricecurrency || null,
    title: tags['og:title'] || null,
    description: tags['og:description'] || tags.description || null,
  };
}

const isProduct = (t: unknown) => t === 'Product' || (Array.isArray(t) && t.includes('Product'));

/** A Product node's lowest GBP price and whether any offer is in stock. */
function productPrice(node: Record<string, unknown>): { pence: number | null; inStock: boolean | null } {
  const raw = node.offers;
  const offers = (Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []) as Record<string, unknown>[];
  let pence: number | null = null;
  let inStock: boolean | null = null;
  for (const o of offers) {
    if (o.priceCurrency !== undefined && o.priceCurrency !== 'GBP') continue;
    const p = amountToPence(o.lowPrice ?? o.price);
    if (p !== null && (pence === null || p < pence)) pence = p;
    const a = availability(o.availability);
    if (a !== null) inStock = inStock === true || a;
  }
  return { pence, inStock };
}

const bareHost = (u: URL) => u.hostname.toLowerCase().replace(/^www\./, '');

/**
 * Every priced Product on a page a search turned up — a product page's one,
 * a category page's ItemList, a PriceRunner category's payload. A listing's
 * URL must stay on the page's own site (a feed of someone else's links is
 * not that site's price). A single product page keeps its sellers.
 */
export function listingsFromPage(page: { payload: string | null; ld: string[]; meta?: PriceMeta | null }, pageUrl: string): Candidate[] {
  const base = new URL(pageUrl);
  const site = bareHost(base);
  if (page.payload) {
    const listed = parseCategoryPayload(page.payload);
    if (listed.length) return listed.slice(0, MAX_LISTINGS_PER_PAGE);
  }
  const found = new Map<string, Candidate>();
  const walk = (o: unknown, depth: number) => {
    if (depth > 30 || o === null || typeof o !== 'object' || found.size >= MAX_LISTINGS_PER_PAGE) return;
    if (Array.isArray(o)) {
      for (const v of o) walk(v, depth + 1);
      return;
    }
    const node = o as Record<string, unknown>;
    if (isProduct(node['@type']) && typeof node.name === 'string') {
      let url: URL;
      try {
        url = new URL(typeof node.url === 'string' && node.url ? node.url : pageUrl, base);
      } catch {
        return;
      }
      const { pence, inStock } = productPrice(node);
      if (pence === null || url.protocol !== 'https:' || bareHost(url) !== site) return;
      url.hash = '';
      if (!found.has(url.toString())) {
        found.set(url.toString(), {
          source: site === 'pricerunner.com' ? 'pricerunner' : 'retailer',
          title: decodeEntities(node.name).trim().slice(0, 300),
          description: typeof node.description === 'string' ? decodeEntities(node.description).trim().slice(0, 1_500) : '',
          url: url.toString(),
          merchant: site,
          pricePence: pence,
          inStock,
        });
      }
      return; // a Product's offers are not more products
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  for (const raw of page.ld) {
    try {
      walk(JSON.parse(raw), 0);
    } catch {
      // One malformed block is not the page.
    }
  }
  const out = [...found.values()];
  // No Product in the JSON-LD: the meta tags' one price, if it is in pounds.
  if (!out.length && page.meta && (page.meta.currency ?? '').toUpperCase() === 'GBP') {
    const pence = amountToPence(page.meta.amount.replace(/[£,\s]/g, ''));
    if (pence !== null && page.meta.title) {
      return [{
        source: site === 'pricerunner.com' ? 'pricerunner' : 'retailer',
        title: page.meta.title.slice(0, 300),
        description: (page.meta.description ?? '').slice(0, 1_500),
        url: pageUrl,
        merchant: site,
        pricePence: pence,
        inStock: null,
      }];
    }
  }
  // One product, on its own page: PriceRunner lists every seller — keep them.
  if (out.length === 1) {
    const product = parseProductLd(page.ld);
    if (product?.offers.length) {
      out[0] = { ...out[0], merchant: product.offers[0].merchant, pricePence: product.lowPence ?? out[0].pricePence, sellers: product.offers };
    }
  }
  return out;
}
