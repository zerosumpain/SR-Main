// hotukdeals tag feeds — the best UK signal for "a deal on a thing like this".
//
// `https://www.hotukdeals.com/rss/tag/<slug>` answers from anywhere, the VPS
// included (checked 2026-10-31), and each item carries the price and merchant
// as attributes: `<pepper:merchant name="Amazon" price="£1,299"/>`. Titles are
// written to be scanned ("32GB DDR5 RAM, RTX 5060 Ti, 1TB NVMe"), which is what
// lets `specs.ts` judge them without a model. There is no keyword-search feed —
// `/rss/search` 404s — so a hunt names one or more tags.
//
// SECURITY. Feed XML is publisher-controlled text, parsed for metadata only:
// the description's HTML is flattened to text through a detached element and
// never rendered, and an item whose link leaves hotukdeals.com is dropped. The
// same rules `$lib/news/feed` follows.

import { loadJsdom } from '$lib/server/jsdom';
import { parsePounds } from '../specs';
import type { Candidate } from '../types';

const MAX_FEED_CHARS = 3_000_000;
const DESCRIPTION_CHARS = 1_500;
const FETCH_TIMEOUT_MS = 15_000;
export const HUKD_ORIGIN = 'https://www.hotukdeals.com';

/** Tag slugs are path segments we build URLs from, so the shape is checked, not trusted. */
export function isHukdTag(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,60}$/.test(slug);
}

export function hukdTagUrl(slug: string): string {
  if (!isHukdTag(slug)) throw new Error(`Not a hotukdeals tag: ${slug}`);
  return `${HUKD_ORIGIN}/rss/tag/${slug}`;
}

export async function parseHukdFeed(xml: string): Promise<Candidate[]> {
  if (xml.length > MAX_FEED_CHARS || /<!DOCTYPE/i.test(xml)) throw new Error('Invalid hotukdeals feed');
  const { JSDOM } = await loadJsdom();
  const dom = new JSDOM(xml, { contentType: 'text/xml' });
  try {
    const doc = dom.window.document;
    if (doc.documentElement.tagName.toLowerCase() !== 'rss') throw new Error('Invalid hotukdeals feed');
    // A detached HTML document to flatten descriptions in — never attached, never rendered.
    const scratch = new JSDOM('').window.document.createElement('div');

    const out: Candidate[] = [];
    for (const item of doc.querySelectorAll('item')) {
      const text = (name: string) => item.getElementsByTagName(name)[0]?.textContent?.trim() ?? '';
      const title = text('title');
      const link = text('link');
      let url: URL;
      try {
        url = new URL(link);
      } catch {
        continue;
      }
      if (url.origin !== HUKD_ORIGIN || !title) continue;

      const merchantEl = item.getElementsByTagName('pepper:merchant')[0];
      // The feed double-escapes some names ("John Lewis &amp;amp; Partners").
      const merchant = merchantEl?.getAttribute('name')?.replace(/&amp;/g, '&').trim() || null;
      const priceAttr = merchantEl?.getAttribute('price') ?? '';
      // A space before every tag, so "<strong>£1,299 - Amazon</strong><p>Best"
      // flattens to two words, not "AmazonBest" — the spec regexes need the gap.
      scratch.innerHTML = text('description').replace(/</g, ' <');
      const description = (scratch.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_CHARS);
      const published = new Date(text('pubDate'));

      out.push({
        source: 'hukd',
        title,
        description,
        url: url.toString(),
        merchant,
        // The attribute first; the "£1,299 - Amazon" lede as a fallback.
        pricePence: parsePounds(priceAttr) ?? parsePounds(description.slice(0, 60)),
        inStock: null,
        postedAt: Number.isNaN(published.getTime()) ? null : published.toISOString(),
      });
    }
    return out;
  } finally {
    dom.window.close();
  }
}

export async function fetchHukdTag(slug: string, fetchFn: typeof fetch = fetch): Promise<Candidate[]> {
  const res = await fetchFn(hukdTagUrl(slug), {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; StrangeRamblings wish list; +https://strangeramblings.com)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) throw new Error(`hotukdeals has no tag "${slug}"`);
  if (!res.ok) throw new Error(`hotukdeals ${slug}: HTTP ${res.status}`);
  return parseHukdFeed(await res.text());
}

// ── Is the deal still live? ──────────────────────────────────────────────────
//
// A tag feed carries expired posts beside live ones and says nothing about
// which is which, so a "match" could be a deal that ended last week (John,
// 2026-11-09: "if it's expired don't show it, the deal is gone"). The deal page
// itself embeds the thread's state as JSON — `"isExpired":true|false` — checked
// 2026-11-09 on ten gaming-pc deals, four of them expired. Related-deal cards
// on the same page carry `threadId`s but not `isExpired`, so the flag nearest
// AFTER this thread's own id is the one we read; a page with no flag is
// `null` (unknown), which the sweep treats as still showing rather than gone.

const DEAL_PAGE_CHARS = 2_000_000;

/** The numeric thread id at the end of a deal URL (`/deals/<slug>-5015853`). */
export function hukdThreadId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.origin !== HUKD_ORIGIN) return null;
    return /^\/deals\/[^/]*?-?(\d{5,})\/?$/.exec(u.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** PURE. `true` expired, `false` live, `null` the page did not say. */
export function parseHukdExpired(html: string, threadId: string | null): boolean | null {
  let from = 0;
  if (threadId) {
    const at = html.search(new RegExp(`"threadId":"?${threadId}"?[,}]`));
    if (at >= 0) from = at;
  }
  const m = /"isExpired":(true|false)/.exec(html.slice(from)) ?? /"isExpired":(true|false)/.exec(html);
  return m ? m[1] === 'true' : null;
}

export async function fetchHukdExpired(url: string, fetchFn: typeof fetch = fetch): Promise<boolean | null> {
  const id = hukdThreadId(url);
  if (!id) return null;
  const res = await fetchFn(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; StrangeRamblings wish list; +https://strangeramblings.com)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  // A deal HUKD has deleted is as gone as an expired one.
  if (res.status === 404 || res.status === 410) return true;
  if (!res.ok) throw new Error(`hotukdeals deal page: HTTP ${res.status}`);
  return parseHukdExpired((await res.text()).slice(0, DEAL_PAGE_CHARS), id);
}
