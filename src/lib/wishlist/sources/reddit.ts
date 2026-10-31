// Reddit deal subreddits — where parts deals are posted before the deal sites
// pick them up. `/r/<sub>/new/.rss` (Atom) answers from the VPS; the JSON API
// does not (403). Posts are free text, so a post counts only when its TITLE
// names a sterling price ("ASUS PRIME RX 9070 XT OC - £659.99 on Amazon UK");
// questions and discussion ("which should I pick?") mostly carry none, and the
// ones that do ("£999 vs £750 — which?") are dropped by `NOT_A_DEAL`.
//
// The subreddits are a closed list — a hunt cannot be pointed at any community.
// SECURITY: as with hotukdeals, the feed is parsed as XML for metadata only,
// content HTML is flattened in a detached element, and a link that leaves
// reddit.com is dropped.

import { loadJsdom } from '$lib/server/jsdom';
import { parsePounds } from '../specs';
import type { Candidate } from '../types';

export const REDDIT_SUBS: Record<string, string> = {
  buildapcsalesuk: 'PC parts deals (UK)',
};

/** A question, a want-to-buy or a plea for help — a price in it is not an offer. */
const NOT_A_DEAL = /\?|^\s*\[?\s*(?:wtb|help|question)\b/i;
const MAX_FEED_CHARS = 3_000_000;
const FETCH_TIMEOUT_MS = 15_000;

export function isRedditSub(sub: string): boolean {
  return Object.hasOwn(REDDIT_SUBS, sub);
}

export async function parseRedditAtom(xml: string): Promise<Candidate[]> {
  if (xml.length > MAX_FEED_CHARS || /<!DOCTYPE/i.test(xml)) throw new Error('Invalid Reddit feed');
  const { JSDOM } = await loadJsdom();
  const dom = new JSDOM(xml, { contentType: 'text/xml' });
  try {
    const doc = dom.window.document;
    if (doc.documentElement.tagName.toLowerCase() !== 'feed') throw new Error('Invalid Reddit feed');
    const scratch = new JSDOM('').window.document.createElement('div');
    const out: Candidate[] = [];
    for (const entry of doc.getElementsByTagName('entry')) {
      const title = entry.getElementsByTagName('title')[0]?.textContent?.trim() ?? '';
      const href = entry.getElementsByTagName('link')[0]?.getAttribute('href') ?? '';
      let url: URL;
      try {
        url = new URL(href);
      } catch {
        continue;
      }
      if (url.protocol !== 'https:' || !/(^|\.)reddit\.com$/.test(url.hostname)) continue;
      const pricePence = parsePounds(title);
      if (!title || pricePence === null || NOT_A_DEAL.test(title)) continue;
      scratch.innerHTML = (entry.getElementsByTagName('content')[0]?.textContent ?? '').replace(/</g, ' <');
      const posted = new Date(entry.getElementsByTagName('updated')[0]?.textContent ?? '');
      out.push({
        source: 'reddit',
        title: title.slice(0, 300),
        description: (scratch.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 1_500),
        url: url.toString(),
        merchant: null,
        pricePence,
        inStock: null,
        postedAt: Number.isNaN(posted.getTime()) ? null : posted.toISOString(),
      });
    }
    return out;
  } finally {
    dom.window.close();
  }
}

export async function fetchSubreddit(sub: string, fetchFn: typeof fetch = fetch): Promise<Candidate[]> {
  if (!isRedditSub(sub)) throw new Error(`Not a known subreddit: ${sub}`);
  const res = await fetchFn(`https://www.reddit.com/r/${sub}/new/.rss`, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; StrangeRamblings wish list; +https://strangeramblings.com)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`reddit r/${sub}: HTTP ${res.status}`);
  return parseRedditAtom(await res.text());
}
