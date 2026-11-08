// Overclockers UK category pages — prebuilt PCs and parts, straight from the
// retailer.
//
// A category page carries ONE JSON-LD `ItemList` of its first 40 products, each
// a `Product` with an `Offer` (GBP price, availability) and a spec-dense
// description ("AMD Ryzen 5 7500F CPU, NVIDIA GeForce RTX 5060 GPU, 16GB DDR5
// RAM, 1TB SSD"). It answers a plain fetch from the VPS (checked 2026-10-31).
// Paging (`?start=`, `?sz=`) is ignored server-side, so a hunt names the
// narrowest category that fits — `pc-systems/pcs-by-price/gaming-pcs-under-1000`
// rather than all gaming PCs. robots.txt disallows search and sort parameters,
// never category paths.

import { amountToPence } from '../specs';
import { availability } from './pricerunner';
import type { Candidate } from '../types';

export const OCUK_ORIGIN = 'https://www.overclockers.co.uk';
const ROOTS = ['pc-systems', 'components', 'laptops', 'monitors', 'peripherals', 'gaming'];

/** A category path we build a URL from, so the shape is checked, not trusted. */
export function isOcukCategory(path: string): boolean {
  const segs = path.split('/');
  return segs.length >= 1 && segs.length <= 4 && ROOTS.includes(segs[0]) && segs.every((s) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(s));
}

export function ocukCategoryUrl(path: string): string {
  if (!isOcukCategory(path)) throw new Error(`Not an Overclockers category: ${path}`);
  return `${OCUK_ORIGIN}/${path}`;
}

/** The products in a category page's `ItemList`. Products that leave overclockers.co.uk are dropped. */
export function parseOcukItemList(blocks: string[]): Candidate[] {
  const out: Candidate[] = [];
  for (const raw of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const list = data as { '@type'?: unknown; itemListElement?: unknown };
    if (list?.['@type'] !== 'ItemList' || !Array.isArray(list.itemListElement)) continue;
    for (const el of list.itemListElement) {
      const p = (el as { item?: Record<string, unknown> })?.item;
      if (!p || p['@type'] !== 'Product' || typeof p.name !== 'string' || typeof p.url !== 'string') continue;
      let url: URL;
      try {
        url = new URL(p.url);
      } catch {
        continue;
      }
      if (url.origin !== OCUK_ORIGIN) continue;
      const offer = (Array.isArray(p.offers) ? p.offers[0] : p.offers) as Record<string, unknown> | undefined;
      if (offer && offer.priceCurrency !== undefined && offer.priceCurrency !== 'GBP') continue;
      out.push({
        source: 'retailer',
        title: p.name.trim().slice(0, 300),
        description: typeof p.description === 'string' ? p.description.trim().slice(0, 1_500) : '',
        url: url.toString(),
        merchant: 'Overclockers UK',
        pricePence: amountToPence(offer?.price),
        inStock: availability(offer?.availability),
      });
    }
  }
  return out;
}
