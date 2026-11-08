// Scan category pages — the biggest UK parts retailer.
//
// Scan turns away a plain fetch from anywhere, but the residential scraper
// reads it (checked 2026-10-31), so these always go that way. A category page
// lists every product as `<li class="product" data-price="1669.99"
// data-description="…">`; `data-price="999999.00"` marks one with no price
// (out of stock, no ETA), which is skipped. There is no JSON-LD, so the
// scraper hands back each `li`'s inner HTML and this reads three things out of
// it with fixed patterns — the attributes, the product link and its title.
//
// The paths are a CLOSED list: a Scan read costs tens of seconds of the
// scraper, so a guessed path that 404s is not checked for at add time — it is
// never allowed to exist. Taken from Scan's own navigation, 2026-10-31.

import type { Candidate } from '../types';

export const SCAN_ORIGIN = 'https://www.scan.co.uk';

export const SCAN_CATEGORIES: Record<string, string> = {
  'computer-hardware/gpu-nvidia/all': 'NVIDIA graphics cards',
  'computer-hardware/gpu-amd/all': 'AMD graphics cards',
  'computer-hardware/cpu-amd/all': 'AMD processors',
  'computer-hardware/cpu-intel/all': 'Intel processors',
  'computer-hardware/memory-ram/all': 'Memory',
  'computer-hardware/hard-drives-internal/all': 'Internal drives',
  'computer-hardware/motherboards-amd/all': 'AMD motherboards',
  'computer-hardware/motherboards-intel/all': 'Intel motherboards',
  'computer-hardware/power-supplies/all': 'Power supplies',
  'computer-hardware/cases/all': 'Cases',
  'gaming-and-sims/monitors/all': 'Monitors',
  'gaming-and-sims/headsets/all': 'Headsets',
  'gaming-and-sims/keyboards/all': 'Keyboards',
  'gaming/mice/all': 'Mice',
};

export function isScanCategory(path: string): boolean {
  return Object.hasOwn(SCAN_CATEGORIES, path);
}

export function scanCategoryUrl(path: string): string {
  if (!isScanCategory(path)) throw new Error(`Not a known Scan category: ${path}`);
  return `${SCAN_ORIGIN}/shop/${path}`;
}

const NO_PRICE = 999_999;
const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/**
 * One `li.product`'s inner HTML → a candidate, or null. The scraper returns
 * inner HTML, so the `li`'s own attributes are not in it — but the wish-list
 * heart inside repeats them (`data-price`, `data-description`).
 */
export function parseScanProduct(html: string): Candidate | null {
  const href = /href="(\/products\/[a-z0-9-]+)"/i.exec(html)?.[1];
  const price = Number(/data-price="([\d.]+)"/.exec(html)?.[1]);
  const title = /<span class="description"><a[^>]*><span>([^<]{3,300})<\/span>/.exec(html)?.[1] ?? /data-description="([^"]{3,300})"/.exec(html)?.[1];
  if (!href || !title) return null;
  const pricePence = Number.isFinite(price) && price > 0 && price < NO_PRICE ? Math.round(price * 100) : null;
  if (pricePence === null) return null;
  return {
    source: 'retailer',
    title: decode(title).trim(),
    description: '',
    url: `${SCAN_ORIGIN}${href}`,
    merchant: 'Scan',
    pricePence,
    inStock: null,
  };
}

export function parseScanList(items: string[]): Candidate[] {
  return items.map(parseScanProduct).filter((c): c is Candidate => c !== null);
}
