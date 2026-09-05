import { JSDOM } from 'jsdom';
import type { NewsStory, NewsWireView } from './types';

const FEED = 'https://arstechnica.com/feed/';
const PAGE_SIZE = 20;

export function isArsStoryId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,239}$/.test(id);
}

/** Read only publisher metadata; RSS article HTML is never rendered directly. */
export function parseArsFeed(xml: string): NewsStory[] {
  if (xml.length > 2_000_000 || /<!DOCTYPE/i.test(xml)) throw new Error('Invalid Ars feed');
  const dom = new JSDOM(xml, { contentType: 'text/xml' });
  try {
    const doc = dom.window.document;
    if (doc.documentElement.tagName !== 'rss' || !doc.querySelector('channel')) {
      throw new Error('Invalid Ars feed');
    }
    const stories: NewsStory[] = [];
    for (const item of doc.querySelectorAll('item')) {
      const text = (name: string) => item.getElementsByTagName(name)[0]?.textContent?.trim() ?? '';
      const title = text('title');
      const published = new Date(text('pubDate'));
      let url: URL;
      try { url = new URL(text('link')); } catch { continue; }
      if (url.origin !== 'https://arstechnica.com' || url.username || url.password) continue;
      const match = url.pathname.match(/^\/[a-z0-9-]+\/\d{4}\/\d{2}\/([a-z0-9-]+)\/$/);
      const id = match?.[1];
      if (!id || !isArsStoryId(id) || !title || !Number.isFinite(published.getTime())) continue;
      url.search = '';
      url.hash = '';
      const comments = Number(text('slash:comments'));
      stories.push({
        key: `ars-technica:${id}`, source: 'ars-technica', sourceLabel: 'Ars Technica', id,
        title, url: url.href, discussionUrl: `${url.href}#comments`, domain: url.hostname,
        author: text('dc:creator') || null, publishedAt: published.toISOString(), score: 0,
        commentCount: Number.isSafeInteger(comments) && comments >= 0 ? comments : 0,
        tags: Array.from(item.getElementsByTagName('category')).map((tag) => tag.textContent?.trim() ?? '').filter(Boolean).slice(0, 8),
        summary: JSDOM.fragment(text('description')).textContent?.trim() ?? '', rank: stories.length + 1,
      });
    }
    return stories;
  } finally {
    dom.window.close();
  }
}

async function readFeed(url: string): Promise<NewsStory[]> {
  const response = await fetch(url, {
    headers: { accept: 'application/rss+xml', 'user-agent': 'StrangeRamblingsNews/1.0 (+https://strangeramblings.com/news)' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseArsFeed(await response.text());
}

export async function fetchArs(view: NewsWireView, limit: number): Promise<NewsStory[]> {
  const stories = new Map<string, NewsStory>();
  for (let page = 1; page <= Math.ceil(limit / PAGE_SIZE); page++) {
    const rows = await readFeed(page === 1 ? FEED : `${FEED}?paged=${page}`);
    for (const story of rows) stories.set(story.key, story);
    if (rows.length < PAGE_SIZE || (view === 'best' && rows.some((story) => Date.parse(story.publishedAt) < Date.now() - 86_400_000))) break;
  }
  return [...stories.values()]
    .filter((story) => view !== 'best' || Date.parse(story.publishedAt) >= Date.now() - 86_400_000)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, limit);
}

/** WordPress's article-specific RSS lookup survives feed expiry and restarts. */
export async function getArsStory(id: string): Promise<NewsStory> {
  if (!isArsStoryId(id)) throw new Error('Invalid news story id');
  const story = (await readFeed(`${FEED}?name=${encodeURIComponent(id)}`)).find((row) => row.id === id);
  if (!story) throw new Error('Ars Technica story was not found');
  return story;
}
