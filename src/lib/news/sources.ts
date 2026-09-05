import type {
  NewsFeed,
  NewsSource,
  NewsSourceState,
  NewsStory,
  NewsWireView,
} from './types';

import { fetchArs, getArsStory, isArsStoryId } from './ars';
const HN_API = 'https://hacker-news.firebaseio.com/v0';
const LOBSTERS = 'https://lobste.rs';
export const NEWS_PAGE_SIZE = 25;
export const MAX_NEWS_STORIES_PER_SOURCE = 100;
const BEST_SCAN_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 3 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_JSON_CHARS = 2_000_000;

interface HackerNewsItem {
  id?: number;
  by?: string;
  descendants?: number;
  score?: number;
  time?: number;
  title?: string;
  text?: string;
  type?: string;
  url?: string;
  dead?: boolean;
  deleted?: boolean;
}

interface LobstersItem {
  short_id?: string;
  created_at?: string;
  title?: string;
  url?: string;
  score?: number;
  comment_count?: number;
  description_plain?: string;
  submitter_user?: string;
  tags?: string[];
  comments_url?: string;
}

interface CacheEntry {
  value: NewsFeed | null;
  expiresAt: number;
  pending: Promise<NewsFeed> | null;
}

const cache = new Map<string, CacheEntry>();

export function normalizeNewsLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return NEWS_PAGE_SIZE;
  return Math.max(
    NEWS_PAGE_SIZE,
    Math.min(MAX_NEWS_STORIES_PER_SOURCE, Math.trunc(parsed)),
  );
}

function decodeHtml(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return text
    .replace(/&#(\d+);/g, (whole, digits: string) => {
      const point = Number(digits);
      try {
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
      } catch {
        return whole;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (whole, digits: string) => {
      const point = Number.parseInt(digits, 16);
      try {
        return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
      } catch {
        return whole;
      }
    })
    .replace(/&(amp|apos|gt|lt|nbsp|quot);/gi, (_, name: string) => named[name.toLowerCase()]);
}

function plainText(html: string | undefined): string {
  if (!html) return '';
  return decodeHtml(
    html
      .replace(/<(br|\/p|\/div)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n'),
  ).trim();
}

function safeHttpUrl(candidate: string | undefined, fallback: string): string {
  if (!candidate) return fallback;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : fallback;
  } catch {
    return fallback;
  }
}

function domainFor(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || 'source';
  } catch {
    return 'source';
  }
}

export function normalizeHackerNews(item: HackerNewsItem, rank = 0): NewsStory | null {
  if (
    !Number.isInteger(item.id) ||
    !item.title?.trim() ||
    item.type !== 'story' ||
    item.dead ||
    item.deleted
  ) {
    return null;
  }
  const id = String(item.id);
  const discussionUrl = `https://news.ycombinator.com/item?id=${id}`;
  const url = safeHttpUrl(item.url, discussionUrl);
  return {
    key: `hacker-news:${id}`,
    source: 'hacker-news',
    sourceLabel: 'Hacker News',
    id,
    title: decodeHtml(item.title.trim()),
    url,
    discussionUrl,
    domain: domainFor(url),
    author: item.by?.trim() || null,
    publishedAt: new Date((item.time ?? 0) * 1000).toISOString(),
    score: Number.isFinite(item.score) ? Number(item.score) : 0,
    commentCount: Number.isFinite(item.descendants) ? Number(item.descendants) : 0,
    tags: [],
    summary: plainText(item.text),
    rank,
  };
}

export function normalizeLobsters(item: LobstersItem, rank = 0): NewsStory | null {
  const id = item.short_id?.trim();
  if (!id || !/^[a-z0-9]{6}$/i.test(id) || !item.title?.trim()) return null;
  const discussionUrl = safeHttpUrl(item.comments_url, `${LOBSTERS}/s/${id}`);
  const url = safeHttpUrl(item.url, discussionUrl);
  const date = new Date(item.created_at ?? 0);
  return {
    key: `lobsters:${id}`,
    source: 'lobsters',
    sourceLabel: 'Lobsters',
    id,
    title: decodeHtml(item.title.trim()),
    url,
    discussionUrl,
    domain: domainFor(url),
    author: item.submitter_user?.trim() || null,
    publishedAt: Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString(),
    score: Number.isFinite(item.score) ? Number(item.score) : 0,
    commentCount: Number.isFinite(item.comment_count) ? Number(item.comment_count) : 0,
    tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 8) : [],
    summary: item.description_plain?.trim() ?? '',
    rank,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'StrangeRamblingsNews/1.0 (+https://strangeramblings.com/news)',
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.text();
    if (raw.length > MAX_JSON_CHARS) throw new Error('response was too large');
    return JSON.parse(raw) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHackerNews(view: NewsWireView, storyLimit: number): Promise<NewsStory[]> {
  const feed = view === 'new' ? 'newstories' : 'topstories';
  const ids = await fetchJson<unknown>(`${HN_API}/${feed}.json`);
  if (!Array.isArray(ids)) throw new Error('unexpected story index');
  const scanLimit =
    view === 'best'
      ? Math.max(BEST_SCAN_LIMIT, storyLimit * 2)
      : storyLimit;
  const requested = ids.filter((id): id is number => Number.isInteger(id)).slice(0, scanLimit);
  const rows: PromiseSettledResult<HackerNewsItem | null>[] = new Array(requested.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(12, requested.length) }, async () => {
      while (cursor < requested.length) {
        const index = cursor;
        cursor += 1;
        try {
          rows[index] = {
            status: 'fulfilled',
            value: await fetchJson<HackerNewsItem | null>(`${HN_API}/item/${requested[index]}.json`),
          };
        } catch (reason) {
          rows[index] = { status: 'rejected', reason };
        }
      }
    }),
  );
  const stories = rows
    .map((row, rank) =>
      row.status === 'fulfilled' && row.value ? normalizeHackerNews(row.value, rank + 1) : null,
    )
    .filter((story): story is NewsStory => story !== null);
  return view === 'best'
    ? stories
        .filter((story) => new Date(story.publishedAt).getTime() >= Date.now() - DAY_MS)
        .sort((a, b) => b.score - a.score || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
        .slice(0, storyLimit)
    : stories;
}

function lobstersFeedUrl(feed: 'hottest' | 'newest', page: number): string {
  if (page === 1) return `${LOBSTERS}/${feed}.json`;
  return feed === 'hottest'
    ? `${LOBSTERS}/page/${page}.json`
    : `${LOBSTERS}/newest/page/${page}.json`;
}

async function fetchLobsters(view: NewsWireView, storyLimit: number): Promise<NewsStory[]> {
  const feeds: Array<'hottest' | 'newest'> =
    view === 'best' ? ['hottest', 'newest'] : [view === 'new' ? 'newest' : 'hottest'];
  const pageCount = Math.ceil(storyLimit / NEWS_PAGE_SIZE);
  const payloads = await Promise.all(
    feeds.flatMap((feed) =>
      Array.from({ length: pageCount }, (_, index) =>
        fetchJson<unknown>(lobstersFeedUrl(feed, index + 1)),
      ),
    ),
  );
  if (payloads.some((rows) => !Array.isArray(rows))) throw new Error('unexpected story index');
  const seen = new Set<string>();
  const stories = payloads
    .flatMap((rows) => rows as unknown[])
    .map((row, rank) => normalizeLobsters((row ?? {}) as LobstersItem, rank + 1))
    .filter((story): story is NewsStory => {
      if (!story || seen.has(story.key)) return false;
      seen.add(story.key);
      return true;
    });
  return view === 'best'
    ? stories
        .filter((story) => new Date(story.publishedAt).getTime() >= Date.now() - DAY_MS)
        .sort((a, b) => b.score - a.score || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
        .slice(0, storyLimit)
    : stories.slice(0, storyLimit);
}

function interleave(groups: NewsStory[][]): NewsStory[] {
  const out: NewsStory[] = [];
  const max = Math.max(0, ...groups.map((group) => group.length));
  for (let rank = 0; rank < max; rank += 1) {
    for (const group of groups) {
      if (group[rank]) out.push(group[rank]);
    }
  }
  return out;
}

function message(err: unknown): string {
  if (err instanceof Error && err.name === 'AbortError') return 'timed out';
  if (err instanceof Error) return err.message.slice(0, 160);
  return String(err).slice(0, 160);
}

async function loadFeed(
  view: NewsWireView,
  previous: NewsFeed | null,
  storyLimit: number,
): Promise<NewsFeed> {
  const [hn, lobsters, ars] = await Promise.allSettled([
    fetchHackerNews(view, storyLimit),
    fetchLobsters(view, storyLimit),
    fetchArs(view, storyLimit),
  ]);
  const hnStories = hn.status === 'fulfilled' ? hn.value : [];
  const lobsterStories = lobsters.status === 'fulfilled' ? lobsters.value : [];
  const arsStories = ars.status === 'fulfilled' ? ars.value : [];
  const states: NewsSourceState[] = [
    {
      source: 'ars-technica', label: 'Ars Technica', count: arsStories.length,
      ok: ars.status === 'fulfilled', error: ars.status === 'rejected' ? message(ars.reason) : null,
    },
    {
      source: 'hacker-news',
      label: 'Hacker News',
      count: hnStories.length,
      ok: hn.status === 'fulfilled',
      error: hn.status === 'rejected' ? message(hn.reason) : null,
    },
    {
      source: 'lobsters',
      label: 'Lobsters',
      count: lobsterStories.length,
      ok: lobsters.status === 'fulfilled',
      error: lobsters.status === 'rejected' ? message(lobsters.reason) : null,
    },
  ];
  const stories =
    view === 'best'
      ? [...hnStories, ...lobsterStories, ...arsStories].sort(
          (a, b) => b.score - a.score || Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
        )
      : interleave([hnStories, lobsterStories, arsStories]);
  const previousKeys = previous ? new Set(previous.stories.map((story) => story.key)) : null;
  return {
    view,
    stories,
    sources: states,
    updatedAt: new Date().toISOString(),
    newSinceLast: previousKeys
      ? stories.reduce((count, story) => count + (previousKeys.has(story.key) ? 0 : 1), 0)
      : 0,
    cached: false,
  };
}

export async function getNewsFeed(
  view: NewsWireView,
  opts: { force?: boolean; limit?: number } = {},
): Promise<NewsFeed> {
  const storyLimit = normalizeNewsLimit(opts.limit);
  const cacheKey = `${view}:${storyLimit}`;
  const now = Date.now();
  const existing = cache.get(cacheKey);
  if (!opts.force && existing?.value && existing.expiresAt > now) {
    return { ...existing.value, cached: true };
  }
  if (!opts.force && existing?.pending) return existing.pending;

  const pending = loadFeed(view, existing?.value ?? null, storyLimit).then((value) => {
    cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS, pending: null });
    return value;
  });
  cache.set(cacheKey, {
    value: existing?.value ?? null,
    expiresAt: existing?.expiresAt ?? 0,
    pending,
  });
  try {
    return await pending;
  } catch (err) {
    cache.set(cacheKey, existing ?? { value: null, expiresAt: 0, pending: null });
    throw err;
  }
}

export function isNewsSource(value: string): value is NewsSource {
  return value === 'hacker-news' || value === 'lobsters' || value === 'ars-technica';
}

export function isNewsStoryId(source: NewsSource, value: string): boolean {
  if (source === 'ars-technica') return isArsStoryId(value);
  return source === 'hacker-news' ? /^\d{1,12}$/.test(value) : /^[a-z0-9]{6}$/i.test(value);
}

export async function getNewsStory(source: NewsSource, id: string): Promise<NewsStory> {
  if (!isNewsStoryId(source, id)) throw new Error('Invalid news story id');
  if (source === 'ars-technica') return getArsStory(id);
  if (source === 'hacker-news') {
    const story = normalizeHackerNews(
      await fetchJson<HackerNewsItem>(`${HN_API}/item/${id}.json`),
    );
    if (!story) throw new Error('Hacker News story was not found');
    return story;
  }
  const story = normalizeLobsters(await fetchJson<LobstersItem>(`${LOBSTERS}/s/${id}.json`));
  if (!story) throw new Error('Lobsters story was not found');
  return story;
}

/** Test isolation for the module-level, in-process feed cache. */
export function clearNewsCache(): void {
  cache.clear();
}
