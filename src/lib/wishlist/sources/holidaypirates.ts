// HolidayPirates — UK package-holiday and city-break deals, ~40 at a time.
//
// `https://www.holidaypirates.com/feed` is RSS 2.0 and answers the VPS
// (checked 2026-10-31); robots.txt disallows only /search, /explore and
// click-out parameters. Each item's title carries the star rating
// ("4⭐ Rimini holiday", "5🌟 family Mauritius holiday") and the description
// the rest ("a 7-night stay … from £225"). Their prices are PER PERSON, so
// candidates carry `perPerson` and a party's budget is compared at price ×
// party (`comparablePrice`).
//
// SECURITY: parsed as XML for metadata only; description HTML is flattened in
// a detached element and never rendered; links must stay on holidaypirates.com.

import { loadJsdom } from '$lib/server/jsdom';
import { parsePounds } from '../specs';
import type { Candidate } from '../types';

export const HOLIDAYPIRATES_FEED = 'https://www.holidaypirates.com/feed';
const ORIGIN = 'https://www.holidaypirates.com';
const MAX_FEED_CHARS = 3_000_000;
const FETCH_TIMEOUT_MS = 15_000;

/** "from £225", "under £900", "for £399" — the deal's headline price, not an upgrade's "extra £80". */
const HEADLINE = /(?:from|for|only|just|under|at)\s+£\s*[\d,]+(?:\.\d{1,2})?(?:\s*k\b)?/i;

export async function parseHolidayPiratesFeed(xml: string): Promise<Candidate[]> {
  if (xml.length > MAX_FEED_CHARS || /<!DOCTYPE/i.test(xml)) throw new Error('Invalid HolidayPirates feed');
  const { JSDOM } = await loadJsdom();
  const dom = new JSDOM(xml, { contentType: 'text/xml' });
  try {
    const doc = dom.window.document;
    if (doc.documentElement.tagName.toLowerCase() !== 'rss') throw new Error('Invalid HolidayPirates feed');
    const scratch = new JSDOM('').window.document.createElement('div');
    const out: Candidate[] = [];
    for (const item of doc.querySelectorAll('item')) {
      const text = (name: string) => item.getElementsByTagName(name)[0]?.textContent?.trim() ?? '';
      const title = text('title');
      let url: URL;
      try {
        url = new URL(text('link'));
      } catch {
        continue;
      }
      if (url.origin !== ORIGIN || !title) continue;
      scratch.innerHTML = text('description').replace(/</g, ' <');
      const description = (scratch.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 1_500);
      const headline = HEADLINE.exec(title)?.[0] ?? HEADLINE.exec(description)?.[0] ?? '';
      const posted = new Date(text('pubDate'));
      out.push({
        source: 'holidaypirates',
        title: title.slice(0, 300),
        description,
        url: url.toString(),
        merchant: 'HolidayPirates',
        pricePence: parsePounds(headline),
        inStock: null,
        postedAt: Number.isNaN(posted.getTime()) ? null : posted.toISOString(),
        perPerson: true,
      });
    }
    return out;
  } finally {
    dom.window.close();
  }
}

export async function fetchHolidayPirates(fetchFn: typeof fetch = fetch): Promise<Candidate[]> {
  const res = await fetchFn(HOLIDAYPIRATES_FEED, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; StrangeRamblings wish list; +https://strangeramblings.com)' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HolidayPirates: HTTP ${res.status}`);
  return parseHolidayPiratesFeed(await res.text());
}
