// The wish list sweep: for each item that is due, read its sources, judge what
// they list, remember it, and send ONE message per item when something moved.
//
// Run by the `wishlist-sweep` heartbeat activity and by "Check now" on the
// page. Sources fail independently — a dead hotukdeals tag must not stop the
// PriceRunner category from being read — and each failure is kept on the item
// as `lastError`, where the page shows it.

import { notifyOwner } from '$lib/server/notify';
import { eventFor, mergeOffer, offerKey, summarise, type AlertEvent } from './alerts';
import { isDue } from './due';
import { KEPT } from './match';
import { fetchHukdExpired, fetchHukdTag } from './sources/hukd';
import { fetchPageScripts, fetchScanCards } from './sources/fetch.server';
import { ocukCategoryUrl, parseOcukItemList } from './sources/ocuk';
import { fetchSubreddit } from './sources/reddit';
import { fetchHolidayPirates } from './sources/holidaypirates';
import { parseScanList, scanCategoryUrl } from './sources/scan';
import { categoryUrl, parseCategoryPayload, parseProductLd } from './sources/pricerunner';
import { searchTheWeb } from './sources/search.server';
import { getItem, listItems, listOffers, saveItem, saveOffer } from './store.server';
import type { Candidate, FeedRef, WishItem, WishOffer } from './types';

const MAX_ITEMS_PER_RUN = 8;

/** A live HUKD deal's page is re-read at most this often. */
const EXPIRY_RECHECK_MS = 60 * 60_000;
/** Deal pages read per item per check — stored offers that left the feed included. */
const MAX_EXPIRY_CHECKS = 40;

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

async function readFeed(feed: FeedRef): Promise<Candidate[]> {
  switch (feed.source) {
    case 'hukd-tag':
      return fetchHukdTag(feed.value);
    case 'pricerunner-cl': {
      const page = await fetchPageScripts(categoryUrl(feed.value));
      if (!page.payload) throw new Error(`PriceRunner ${feed.value}: no product list`);
      return parseCategoryPayload(page.payload);
    }
    case 'ocuk-cat': {
      const page = await fetchPageScripts(ocukCategoryUrl(feed.value));
      const list = parseOcukItemList(page.ld);
      if (!list.length) throw new Error(`Overclockers ${feed.value}: no product list`);
      return list;
    }
    case 'scan-cat':
      return parseScanList(await fetchScanCards(scanCategoryUrl(feed.value)));
    case 'reddit':
      return fetchSubreddit(feed.value);
    case 'holidaypirates':
      return fetchHolidayPirates();
    case 'search':
    case 'tavily':
      // All of an item's searches run together, against its daily allowance — see checkItem.
      return [];
  }
}

/**
 * Read a HUKD offer's deal page and stamp `expired` on it. Mutates the offer.
 * A page that cannot be read leaves the offer as it was (shown) and notes the
 * failure — an unreachable page is not evidence the deal has gone.
 */
async function readExpiry(offer: WishOffer, now: Date, budget: { left: number }, errors: string[]): Promise<void> {
  if (offer.expired) return;
  if (offer.expiryCheckedAt && now.getTime() - Date.parse(offer.expiryCheckedAt) < EXPIRY_RECHECK_MS) return;
  budget.left--;
  try {
    const expired = await fetchHukdExpired(offer.url);
    offer.expiryCheckedAt = now.toISOString();
    if (expired) offer.expired = true;
  } catch (err) {
    if (!errors.some((e) => e.startsWith('hukd expiry'))) errors.push(`hukd expiry: ${errMsg(err)}`);
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
        candidates.push(...(await readFeed(feed)));
      } catch (err) {
        errors.push(`${feed.source} ${feed.value}: ${errMsg(err)}`);
      }
    }
    const web = await searchTheWeb(item, now);
    candidates.push(...web.candidates);
    errors.push(...web.errors);
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
  const budget = { left: MAX_EXPIRY_CHECKS };
  let kept = 0;
  const seen = new Set<string>();
  for (const c of candidates) {
    if (c.pricePence === null) continue;
    const key = offerKey(item.id, c.url);
    if (seen.has(key)) continue;
    seen.add(key);
    const prev = stored.get(key) ?? null;
    const next = mergeOffer(item, prev, { ...c, pricePence: c.pricePence }, now);
    // A hunt keeps listings worth looking at — including ones that meet every
    // spec but cost too much, tracked in case the price falls — and any it
    // already holds, so a match that turns into a "no" is recorded as such. A
    // category page is a hundred products; storing every one would bury the
    // few that matter.
    if (item.kind === 'hunt' && !prev && !KEPT.includes(next.verdict)) continue;
    if (next.source === 'hukd' && budget.left > 0) await readExpiry(next, now, budget, errors);
    if (next.expired) {
      // The deal is gone: recorded so it is never re-alerted, never shown.
      await saveOffer(next);
      continue;
    }
    const event = eventFor(item, prev, next, c.postedAt, now);
    if (event) {
      next.alertedPence = next.pricePence;
      events.push({ ...event, offer: next });
    }
    await saveOffer(next);
    kept++;
  }

  // A HUKD post that has dropped off its tag feed is still on the page until
  // someone says it has gone — and expiry is usually why it dropped off.
  for (const o of stored.values()) {
    if (budget.left <= 0) break;
    if (o.source !== 'hukd' || o.expired || seen.has(o.key) || o.verdict === 'no') continue;
    await readExpiry(o, now, budget, errors);
    if (o.expired) await saveOffer(o);
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
  const order = { match: 0, possible: 1, near: 2, over: 3, no: 4 } as const;
  // An expired deal is gone — it is kept in the store only so it never re-alerts.
  return offers.filter((o) => !o.expired).sort((a, b) => order[a.verdict] - order[b.verdict] || a.pricePence - b.pricePence);
}
