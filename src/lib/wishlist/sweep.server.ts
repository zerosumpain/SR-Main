// The wish list sweep: for each item that is due, read its sources, judge what
// they list, remember it, and send ONE message per item when something moved.
//
// Run by the `wishlist-sweep` heartbeat activity and by "Check now" on the
// page. Sources fail independently — a dead hotukdeals tag must not stop the
// PriceRunner category from being read — and each failure is kept on the item
// as `lastError`, where the page shows it.

import { notifyOwner } from '$lib/server/notify';
import { search as tavilySearch } from '$lib/deepdive/tavily';
import { eventFor, mergeOffer, offerKey, summarise, type AlertEvent } from './alerts';
import { isDue, searchDue } from './due';
import { ALERTABLE } from './match';
import { fetchHukdTag } from './sources/hukd';
import { fetchPageScripts } from './sources/fetch.server';
import { categoryUrl, isAllowedPricerunnerUrl, parseCategoryPayload, parseProductLd } from './sources/pricerunner';
import { getItem, listItems, listOffers, saveItem, saveOffer } from './store.server';
import type { Candidate, FeedRef, WishItem, WishOffer } from './types';

const MAX_ITEMS_PER_RUN = 8;
const SEARCH_PRODUCT_PAGES = 3;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** A product page (PriceRunner or a retailer's) as one candidate: the cheapest seller's price. */
async function readProductPage(url: string): Promise<Candidate> {
  const page = await fetchPageScripts(url);
  const product = parseProductLd(page.ld);
  if (!product || product.lowPence === null) throw new Error(`no price on ${new URL(url).hostname}`);
  const best = product.offers[0];
  return {
    source: url.startsWith('https://www.pricerunner.com/') ? 'pricerunner' : 'retailer',
    title: product.title,
    description: product.description,
    url,
    merchant: best?.merchant ?? null,
    pricePence: product.lowPence,
    inStock: product.offers.length ? product.offers.some((o) => o.inStock === true) : null,
    sellers: product.offers,
  };
}

async function readFeed(feed: FeedRef, item: WishItem, now: Date): Promise<Candidate[]> {
  switch (feed.source) {
    case 'hukd-tag':
      return fetchHukdTag(feed.value);
    case 'pricerunner-cl': {
      const page = await fetchPageScripts(categoryUrl(feed.value));
      if (!page.payload) throw new Error(`PriceRunner ${feed.value}: no product list`);
      return parseCategoryPayload(page.payload);
    }
    case 'tavily': {
      if (!searchDue(item, now)) return [];
      item.lastSearchedAt = now.toISOString();
      const res = await tavilySearch(feed.value, { purpose: 'wishlist', maxResults: 8, includeDomains: ['pricerunner.com'] });
      const urls = res.results.map((r) => r.url).filter(isAllowedPricerunnerUrl).slice(0, SEARCH_PRODUCT_PAGES);
      const out: Candidate[] = [];
      for (const u of urls) {
        try {
          out.push(await readProductPage(u));
        } catch {
          // One unreadable result is not the search failing.
        }
      }
      return out;
    }
  }
}

export interface ItemCheck {
  itemId: string;
  candidates: number;
  kept: number;
  events: number;
  notified: boolean;
  errors: string[];
}

export async function checkItem(item: WishItem, now = new Date()): Promise<ItemCheck> {
  const errors: string[] = [];
  const candidates: Candidate[] = [];

  if (item.kind === 'hunt') {
    for (const feed of item.feeds) {
      try {
        candidates.push(...(await readFeed(feed, item, now)));
      } catch (err) {
        errors.push(`${feed.source} ${feed.value}: ${errMsg(err)}`);
      }
    }
  } else {
    for (const url of item.urls) {
      try {
        candidates.push(await readProductPage(url));
      } catch (err) {
        errors.push(errMsg(err));
      }
    }
  }

  const stored = new Map((await listOffers(item.id)).map((o) => [o.key, o]));
  const events: AlertEvent[] = [];
  let kept = 0;
  const seen = new Set<string>();
  for (const c of candidates) {
    if (c.pricePence === null) continue;
    const key = offerKey(item.id, c.url);
    if (seen.has(key)) continue;
    seen.add(key);
    const prev = stored.get(key) ?? null;
    const next = mergeOffer(item, prev, { ...c, pricePence: c.pricePence }, now);
    // A hunt keeps only listings worth looking at (and any it already holds, so
    // a match that turns into a "no" is recorded as such). A category page is a
    // hundred products; storing every one would bury the few that matter.
    if (item.kind === 'hunt' && !prev && !ALERTABLE.includes(next.verdict)) continue;
    const event = eventFor(item, prev, next, c.postedAt, now);
    if (event) {
      next.alertedPence = next.pricePence;
      events.push({ ...event, offer: next });
    }
    await saveOffer(next);
    kept++;
  }

  let notified = false;
  const message = summarise(item, events);
  if (message) {
    const res = await notifyOwner({
      category: 'wishlist',
      title: message.title,
      body: message.body,
      url: message.url,
      severity: 'info',
      dedupeKey: `wishlist:${item.id}:${now.toISOString().slice(0, 13)}`,
    });
    notified = res.raised;
  }

  item.lastCheckedAt = now.toISOString();
  item.lastError = errors.length ? errors.join(' · ').slice(0, 500) : null;
  await saveItem(item);
  return { itemId: item.id, candidates: candidates.length, kept, events: events.length, notified, errors };
}

export async function checkItemById(id: string): Promise<ItemCheck | null> {
  const item = await getItem(id);
  return item ? checkItem(item) : null;
}

export interface SweepResult {
  due: number;
  checked: ItemCheck[];
}

export async function sweepWishlist(now = new Date()): Promise<SweepResult> {
  const items = await listItems('owner');
  const due = items
    .filter((i) => isDue(i, now))
    .sort((a, b) => (a.lastCheckedAt ?? '').localeCompare(b.lastCheckedAt ?? ''));
  const checked: ItemCheck[] = [];
  for (const item of due.slice(0, MAX_ITEMS_PER_RUN)) {
    try {
      checked.push(await checkItem(item, now));
    } catch (err) {
      checked.push({ itemId: item.id, candidates: 0, kept: 0, events: 0, notified: false, errors: [errMsg(err)] });
    }
  }
  return { due: due.length, checked };
}

/** Offers for the page, best first. */
export function rankOffers(offers: WishOffer[]): WishOffer[] {
  const order = { match: 0, possible: 1, near: 2, no: 3 } as const;
  return [...offers].sort((a, b) => order[a.verdict] - order[b.verdict] || a.pricePence - b.pricePence);
}
