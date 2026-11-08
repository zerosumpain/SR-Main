// Shopify shops — most small UK PC builders (ZeroLag, DirectComputers,
// PCGamingCases, Darukh, checked 2026-11-01) — publish their catalogue as JSON:
// `/collections/<handle>/products.json` lists a category, `/products/<handle>.json`
// one product, and `/cart.js` says the shop's currency. A web search that lands
// on such a page reads the JSON instead of the theme's HTML, which often has no
// structured price at all, and gets the full description (where the specs are).
//
// SECURITY. `body_html` is shop-controlled HTML, flattened to text by stripping
// tags here and only ever rendered as text.

import { amountToPence } from '../specs';
import { decodeEntities } from './search';
import type { Candidate } from '../types';

const MAX_PRODUCTS = 100;
const DESCRIPTION_CHARS = 1_500;

/** The JSON endpoint for a Shopify-shaped URL, or null when the path is not one. */
export function shopifyJsonUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const collection = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?collections\/([a-z0-9][a-z0-9-]*)\/?$/i.exec(u.pathname);
  if (collection) return `${u.origin}/collections/${collection[1]}/products.json?limit=250`;
  const product = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:collections\/[a-z0-9-]+\/)?products\/([a-z0-9][a-z0-9-]*)\/?$/i.exec(u.pathname);
  if (product) return `${u.origin}/products/${product[1]}.json`;
  return null;
}

function toText(html: string): string {
  return decodeEntities(html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DESCRIPTION_CHARS);
}

interface ShopifyVariant {
  price?: unknown;
  available?: unknown;
}
interface ShopifyProduct {
  title?: unknown;
  handle?: unknown;
  body_html?: unknown;
  variants?: ShopifyVariant[];
}

/**
 * Products from `products.json` (`{products: [...]}`) or `<handle>.json`
 * (`{product: {...}}`), priced at the cheapest variant — the base build, which
 * is what the title describes.
 */
export function parseShopifyProducts(json: string, origin: string): Candidate[] {
  let data: { products?: ShopifyProduct[]; product?: ShopifyProduct };
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const list = Array.isArray(data?.products) ? data.products : data?.product ? [data.product] : [];
  const out: Candidate[] = [];
  const merchant = new URL(origin).hostname.replace(/^www\./, '');
  for (const p of list.slice(0, MAX_PRODUCTS)) {
    if (typeof p.title !== 'string' || typeof p.handle !== 'string' || !/^[a-z0-9][a-z0-9-]*$/i.test(p.handle)) continue;
    const variants = Array.isArray(p.variants) ? p.variants : [];
    const prices = variants
      .map((v) => ({ pence: amountToPence(v.price), available: v.available }))
      .filter((v): v is { pence: number; available: unknown } => v.pence !== null);
    if (!prices.length) continue;
    const cheapest = prices.reduce((a, b) => (b.pence < a.pence ? b : a));
    out.push({
      source: 'retailer',
      title: decodeEntities(p.title).trim().slice(0, 300),
      description: typeof p.body_html === 'string' ? toText(p.body_html) : '',
      url: `${origin}/products/${p.handle}`,
      merchant,
      pricePence: cheapest.pence,
      inStock: variants.some((v) => v.available === true) ? true : variants.every((v) => v.available === false) ? false : null,
    });
  }
  return out;
}
