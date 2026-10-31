// PriceRunner (Klarna) — one product page lists every UK seller's price, so it
// is both the refresh for a tracked product and the cross-retailer compare.
//
// What robots.txt allows decides what this reads (checked 2026-10-31): product
// pages `/pl/<id>/…` without a `p=` query, and category pages `/cl/<id>/<name>`
// without `q=` or stacked attribute filters. `/results` (search) is
// DISALLOWED, so there is no search here — discovery is the category page,
// filtered by our own matcher, plus links other sources turn up.
//
// Two shapes, both already in the HTML: a product page carries schema.org
// `Product` JSON-LD with an `AggregateOffer` per seller; a category page
// carries its product list in `<script id="initial_payload">` JSON. Neither
// needs a model. From the VPS both come back as an empty 202 (a bot check), so
// `fetch.server.ts` falls back to the residential scraper on homeserv.

import { amountToPence } from '../specs';
import type { Candidate } from '../types';

export const PRICERUNNER_ORIGIN = 'https://www.pricerunner.com';

/** True only for the two path shapes robots.txt lets us read. */
export function isAllowedPricerunnerUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.origin !== PRICERUNNER_ORIGIN || u.search || u.hash) return false;
  return /^\/pl\/\d+-\d+\/[^?]+$/.test(u.pathname) || /^\/cl\/\d+\/[A-Za-z0-9-]+$/.test(u.pathname);
}

export function isPricerunnerCategory(value: string): boolean {
  return /^\d+\/[A-Za-z0-9-]+$/.test(value);
}

export function categoryUrl(value: string): string {
  if (!isPricerunnerCategory(value)) throw new Error(`Not a PriceRunner category: ${value}`);
  return `${PRICERUNNER_ORIGIN}/cl/${value}`;
}

/** The JSON inside `<script id="initial_payload">`, or null. */
export function extractInitialPayload(html: string): string | null {
  const m = /<script[^>]*\bid="initial_payload"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  return m ? m[1] : null;
}

/** Every JSON-LD block's text. */
export function extractLdBlocks(html: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) out.push(m[1]);
  return out;
}

interface PayloadProduct {
  name?: unknown;
  url?: unknown;
  description?: unknown;
  lowestPrice?: { amount?: unknown; currency?: unknown } | null;
}

/**
 * Products from a category page's payload. The payload is a React Query cache
 * dump whose shape PriceRunner changes freely, so this walks it for anything
 * product-shaped (name + url + lowestPrice) rather than following one path.
 */
export function parseCategoryPayload(json: string): Candidate[] {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    return [];
  }
  const found = new Map<string, Candidate>();
  const walk = (o: unknown, depth: number) => {
    if (depth > 40 || o === null || typeof o !== 'object') return;
    if (Array.isArray(o)) {
      for (const v of o) walk(v, depth + 1);
      return;
    }
    const p = o as PayloadProduct;
    if (typeof p.name === 'string' && typeof p.url === 'string' && p.lowestPrice && typeof p.lowestPrice === 'object') {
      const url = p.url.startsWith('/') ? PRICERUNNER_ORIGIN + p.url : p.url;
      if (p.lowestPrice.currency === 'GBP' && isAllowedPricerunnerUrl(url) && !found.has(url)) {
        found.set(url, {
          source: 'pricerunner',
          title: p.name,
          description: typeof p.description === 'string' ? p.description : '',
          url,
          merchant: null,
          pricePence: amountToPence(p.lowestPrice.amount),
          inStock: null,
        });
      }
      return;
    }
    for (const v of Object.values(o)) walk(v, depth + 1);
  };
  walk(root, 0);
  return [...found.values()];
}

export interface SellerOffer {
  merchant: string;
  pricePence: number;
  inStock: boolean | null;
}

export interface ProductPage {
  title: string;
  description: string;
  lowPence: number | null;
  offers: SellerOffer[];
}

export function availability(v: unknown): boolean | null {
  if (typeof v !== 'string') return null;
  if (/InStock|LimitedAvailability|PreOrder|OnlineOnly/i.test(v)) return true;
  if (/OutOfStock|SoldOut|Discontinued/i.test(v)) return false;
  return null;
}

/**
 * A `Product` from JSON-LD blocks. Generic on purpose: PriceRunner's product
 * pages use it, and so do most retailer product pages, so a tracked item on a
 * retailer URL reads through the same function.
 */
export function parseProductLd(blocks: string[]): ProductPage | null {
  for (const raw of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const nodes = Array.isArray(data)
      ? data
      : data && typeof data === 'object' && Array.isArray((data as { '@graph'?: unknown[] })['@graph'])
        ? (data as { '@graph': unknown[] })['@graph']
        : [data];
    for (const n of nodes) {
      if (!n || typeof n !== 'object') continue;
      const node = n as Record<string, unknown>;
      const type = node['@type'];
      if (type !== 'Product' && !(Array.isArray(type) && type.includes('Product'))) continue;

      const offersRaw = node.offers as Record<string, unknown> | Record<string, unknown>[] | undefined;
      const list: Record<string, unknown>[] = [];
      let low: number | null = null;
      if (Array.isArray(offersRaw)) list.push(...offersRaw);
      else if (offersRaw && typeof offersRaw === 'object') {
        if (Array.isArray(offersRaw.offers)) list.push(...(offersRaw.offers as Record<string, unknown>[]));
        else list.push(offersRaw);
        if (offersRaw.priceCurrency === 'GBP' || offersRaw.priceCurrency === undefined) {
          low = amountToPence(offersRaw.lowPrice);
        }
      }
      const offers: SellerOffer[] = [];
      for (const o of list) {
        if (o.priceCurrency && o.priceCurrency !== 'GBP') continue;
        const pence = amountToPence(o.price);
        if (pence === null) continue;
        const seller = o.seller as { name?: unknown } | undefined;
        offers.push({
          merchant: typeof seller?.name === 'string' ? seller.name : 'Seller',
          pricePence: pence,
          inStock: availability(o.availability),
        });
      }
      offers.sort((a, b) => a.pricePence - b.pricePence);
      if (low === null && offers.length) low = offers[0].pricePence;
      return {
        title: typeof node.name === 'string' ? node.name : '',
        description: typeof node.description === 'string' ? node.description : '',
        lowPence: low,
        offers,
      };
    }
  }
  return null;
}
