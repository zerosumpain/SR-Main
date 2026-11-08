// What changed since last time, and is it worth telling someone? PURE.
//
// The sweep sees the same listings over and over; an alert must mean something
// moved. One listing alerts once per price band — `alertedPence` records the
// price it last alerted at, and only a cheaper price (by ALERT_STEP) or an
// improved verdict alerts again. A hunt's first sweep would otherwise fire on
// every matching post in a 30-item feed, so the sweep folds one item's events
// into ONE notification (`summarise`), best first.

import { evaluate, formatPence, verdictRank, ALERTABLE } from './match';
import type { Candidate, PricePoint, WishItem, WishOffer } from './types';

const HISTORY_CAP = 90;
/** A re-alert needs the price at least this much under the last alerted price. */
const ALERT_STEP = 0.03;
/** A tracked item's drop worth a message without a target. */
const DROP_STEP = 0.05;
/** A deal post older than this on first sight is history, not news. */
const STALE_POST_MS = 14 * 24 * 3600_000;

export type AlertKind = 'found' | 'cheaper' | 'target' | 'drop' | 'stock' | 'low';

export interface AlertEvent {
  kind: AlertKind;
  offer: WishOffer;
  line: string;
}

/** Stable key per listing: one HUKD post, one PriceRunner product, one retailer page. */
export function offerKey(itemId: string, url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
  return `${itemId}:${(h >>> 0).toString(36)}`;
}

/** Merge a freshly seen candidate into the stored offer (or start one). */
export function mergeOffer(item: WishItem, prev: WishOffer | null, c: Candidate & { pricePence: number }, now: Date): WishOffer {
  const at = now.toISOString();
  const { verdict, results } = evaluate(c, item.criteria, now);
  const point: PricePoint = { at, pence: c.pricePence, inStock: c.inStock };
  const history = prev ? [...prev.history] : [];
  const last = history[history.length - 1];
  // A point per CHANGE, not per sweep — a flat price for a month is one point.
  if (!last || last.pence !== point.pence || last.inStock !== point.inStock) history.push(point);
  return {
    itemId: item.id,
    key: offerKey(item.id, c.url),
    source: c.source,
    title: c.title.slice(0, 300),
    description: c.description.slice(0, 1_500),
    url: c.url,
    merchant: c.merchant,
    pricePence: c.pricePence,
    inStock: c.inStock,
    verdict,
    results,
    firstSeenAt: prev?.firstSeenAt ?? at,
    lastSeenAt: at,
    history: history.slice(-HISTORY_CAP),
    alertedPence: prev?.alertedPence ?? null,
    ...(c.sellers ? { sellers: c.sellers.slice(0, 12) } : {}),
    ...(c.perPerson ? { perPerson: true } : {}),
  };
}

function label(o: WishOffer): string {
  return `${formatPence(o.pricePence)}${o.merchant ? ` at ${o.merchant}` : ''} — ${o.title.slice(0, 90)}`;
}

/** The event this offer raises, if any. Mutates nothing; the sweep stamps `alertedPence`. */
export function eventFor(item: WishItem, prev: WishOffer | null, next: WishOffer, postedAt: string | null | undefined, now: Date): AlertEvent | null {
  if (item.kind === 'hunt') {
    if (!ALERTABLE.includes(next.verdict)) return null;
    if (!prev && postedAt && now.getTime() - Date.parse(postedAt) > STALE_POST_MS) return null;
    const lastAlert = prev?.alertedPence ?? null;
    if (lastAlert === null) {
      const tag = next.verdict === 'match' ? 'Match' : next.verdict === 'near' ? 'Near miss' : 'Worth a look';
      return { kind: 'found', offer: next, line: `${tag}: ${label(next)}` };
    }
    if (next.pricePence <= lastAlert * (1 - ALERT_STEP)) {
      return { kind: 'cheaper', offer: next, line: `Cheaper (was ${formatPence(lastAlert)}): ${label(next)}` };
    }
    if (prev && verdictRank(next.verdict) < verdictRank(prev.verdict) && next.verdict === 'match') {
      return { kind: 'found', offer: next, line: `Now a match: ${label(next)}` };
    }
    return null;
  }

  // track
  if (!prev) return null; // the first read is the baseline, not news
  if (prev.inStock === false && next.inStock === true) {
    return { kind: 'stock', offer: next, line: `Back in stock: ${label(next)}` };
  }
  const lastAlert = next.alertedPence;
  const fresh = lastAlert === null || next.pricePence <= lastAlert * (1 - ALERT_STEP);
  if (item.targetPricePence !== null && next.pricePence <= item.targetPricePence && fresh) {
    return { kind: 'target', offer: next, line: `At or under your ${formatPence(item.targetPricePence)}: ${label(next)}` };
  }
  if (next.pricePence <= prev.pricePence * (1 - DROP_STEP) && fresh) {
    const lowest = Math.min(...prev.history.map((h) => h.pence));
    const kind: AlertKind = prev.history.length >= 2 && next.pricePence < lowest ? 'low' : 'drop';
    return { kind, offer: next, line: `${kind === 'low' ? 'Lowest yet' : 'Price drop'} (was ${formatPence(prev.pricePence)}): ${label(next)}` };
  }
  return null;
}

/** One message per item per sweep: the best three events, and a count of the rest. */
export function summarise(item: WishItem, events: AlertEvent[]): { title: string; body: string; url: string } | null {
  if (!events.length) return null;
  const sorted = [...events].sort(
    (a, b) => verdictRank(a.offer.verdict) - verdictRank(b.offer.verdict) || a.offer.pricePence - b.offer.pricePence,
  );
  const top = sorted.slice(0, 3);
  const lines = top.map((e) => `• ${e.line}\n  ${e.offer.url}`);
  if (sorted.length > top.length) lines.push(`…and ${sorted.length - top.length} more on the page.`);
  const title = item.kind === 'hunt' ? `Wish list: ${item.title}` : `Price watch: ${item.title}`;
  return { title, body: lines.join('\n'), url: `/home/wishlist#${item.id}` };
}
