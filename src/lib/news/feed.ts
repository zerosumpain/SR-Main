// One reader for every syndicated source on the desk.
//
// This started as `ars.ts` — eighty lines that could read exactly one feed.
// Adding a second publisher meant copying them, which is why the desk carried
// three sources for as long as it did.
//
// It reads RSS (`<rss><channel><item>`) and Atom (`<feed><entry>`), because the
// two feeds the public-sector lane most needs are Atom and the one already here
// is RSS. Everything a publisher differs on — where the id lives in the URL,
// whether it paginates, whether it has comments — is a field on the source
// definition rather than a branch in here.
//
// SECURITY. Feed XML is publisher-controlled text. It is parsed for metadata
// only and never rendered as HTML: `summary` is flattened to text through a
// detached fragment, and any item whose link leaves the declared origin is
// dropped rather than trusted.

import { loadJsdom } from '$lib/server/jsdom';
import { canonicalUrl } from './canonical';
import { newsSourceDef, type NewsSource, type NewsSourceDef } from '$lib/constants/news-sources';
import type { NewsStory, NewsWireView } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_FEED_CHARS = 2_000_000;
const DEFAULT_PAGE_SIZE = 20;

/** Ids are used in URLs and as database keys, so the shape is checked, not trusted. */
export function isFeedStoryId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,239}$/.test(id);
}

/** The story id for an article URL, or null when the path is not an article. */
export function feedStoryId(def: NewsSourceDef<NewsSource>, url: URL): string | null {
  if (def.pathPattern) {
    const matched = url.pathname.match(def.pathPattern);
    return matched?.[1] && isFeedStoryId(matched[1]) ? matched[1] : null;
  }
  // No declared shape: the last path segment. GOV.UK and ONS both put the slug
  // there, and it is the same value Ars's fuller pattern captures.
  const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
  return isFeedStoryId(last) ? last : null;
}

/**
 * Parse one feed document into stories.
 *
 * Exported for tests: a parser whose only entry point does network I/O is a
 * parser nobody checks the edge cases of.
 */
export async function parseFeed(source: NewsSource, xml: string): Promise<NewsStory[]> {
  const def = newsSourceDef(source);
  if (xml.length > MAX_FEED_CHARS || /<!DOCTYPE/i.test(xml)) {
    throw new Error(`Invalid ${def.label} feed`);
  }
  const { JSDOM } = await loadJsdom();
  const dom = new JSDOM(xml, { contentType: 'text/xml' });
  try {
    const doc = dom.window.document;
    const root = doc.documentElement.tagName.toLowerCase();
    const isAtom = root === 'feed';
    if (!isAtom && (root !== 'rss' || !doc.querySelector('channel'))) {
      throw new Error(`Invalid ${def.label} feed`);
    }

    const stories: NewsStory[] = [];
    for (const item of doc.querySelectorAll(isAtom ? 'entry' : 'item')) {
      const text = (name: string) => item.getElementsByTagName(name)[0]?.textContent?.trim() ?? '';

      const title = text('title');
      // Atom carries the article URL on <link href>; RSS puts it in the body of
      // <link>. Asking for the wrong one silently yields an empty string.
      const rawLink = isAtom
        ? item.querySelector('link[rel="alternate"], link')?.getAttribute('href')?.trim() ?? ''
        : text('link');
      const published = new Date(isAtom ? text('updated') || text('published') : text('pubDate'));

      let url: URL;
      try {
        url = new URL(rawLink);
      } catch {
        continue;
      }
      if (def.origin && url.origin !== def.origin) continue;
      if (url.username || url.password) continue;

      const id = feedStoryId(def, url);
      if (!id || !title || !Number.isFinite(published.getTime())) continue;

      url.search = '';
      url.hash = '';
      const comments = Number(text('slash:comments'));
      const summaryHtml = isAtom ? text('summary') || text('content') : text('description');

      stories.push({
        key: `${def.id}:${id}`,
        source: def.id,
        sourceLabel: def.label,
        id,
        title,
        url: url.href,
        canonicalUrl: canonicalUrl(url.href),
        discussionUrl: def.commentsAnchor ? `${url.href}${def.commentsAnchor}` : url.href,
        domain: url.hostname,
        author: text('dc:creator') || text('name') || null,
        publishedAt: published.toISOString(),
        // A syndicated feed has no votes. `heat` is what makes that rankable.
        score: 0,
        commentCount: Number.isSafeInteger(comments) && comments >= 0 ? comments : 0,
        tags: Array.from(item.getElementsByTagName('category'))
          .map((tag) => tag.textContent?.trim() || tag.getAttribute('term')?.trim() || '')
          .filter(Boolean)
          .slice(0, 8),
        summary: JSDOM.fragment(summaryHtml).textContent?.trim() ?? '',
        rank: stories.length + 1,
        heat: 0,
        alsoOn: [],
      });
    }
    return stories;
  } finally {
    dom.window.close();
  }
}

async function readFeed(source: NewsSource, url: string): Promise<NewsStory[]> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9',
      'user-agent': 'StrangeRamblingsNews/1.0 (+https://strangeramblings.com/news)',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await parseFeed(source, await response.text());
}

export async function fetchFeedSource(
  source: NewsSource,
  view: NewsWireView,
  limit: number,
): Promise<NewsStory[]> {
  const def = newsSourceDef(source);
  if (!def.feedUrl) throw new Error(`${def.label} has no feed URL`);
  const pageSize = def.pageSize ?? DEFAULT_PAGE_SIZE;

  const stories = new Map<string, NewsStory>();
  const pages = def.paged ? Math.ceil(limit / pageSize) : 1;
  for (let page = 1; page <= pages; page++) {
    const rows = await readFeed(source, page === 1 ? def.feedUrl : `${def.feedUrl}?paged=${page}`);
    for (const story of rows) stories.set(story.key, story);
    // Stop early once the page is short or we have paged past the Best window —
    // another request would only fetch stories about to be filtered out.
    if (
      rows.length < pageSize ||
      (view === 'best' && rows.some((story) => Date.parse(story.publishedAt) < Date.now() - DAY_MS))
    ) {
      break;
    }
  }

  return [...stories.values()]
    .filter((story) => view !== 'best' || Date.parse(story.publishedAt) >= Date.now() - DAY_MS)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, limit);
}

/** One story by id, for a saved link or a reader page. */
export async function getFeedStory(source: NewsSource, id: string): Promise<NewsStory> {
  const def = newsSourceDef(source);
  if (!isFeedStoryId(id)) throw new Error('Invalid news story id');
  if (!def.feedUrl) throw new Error(`${def.label} has no feed URL`);

  // WordPress can be asked for one article by slug, which still answers long
  // after that article has fallen off the feed. Without it, a saved link only
  // resolves while the story is still current — so the scan is the fallback,
  // not the plan.
  const url = def.wordpressNameLookup
    ? `${def.feedUrl}?name=${encodeURIComponent(id)}`
    : def.feedUrl;
  const story = (await readFeed(source, url)).find((row) => row.id === id);
  if (!story) throw new Error(`${def.label} story was not found`);
  return story;
}
