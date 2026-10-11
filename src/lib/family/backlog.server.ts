// The family backlog — storage and the one network job: finding out what a
// shared link is called. The rules are in ./backlog (PURE).
//
// Every fetch goes through guardedPublicFetch: a shared link is a URL a
// family member typed into the server, so it is treated as hostile — public
// addresses only, every redirect re-checked, small bodies, short timeouts.
// A link that cannot be described is still added; the phone names it by host.

import { and, eq, gte, inArray, ne, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { familyBacklogItem } from '$lib/db/schema';
import { guardedPublicFetch } from '$lib/server/safe-fetch';
import {
  FINISHED_DAYS,
  NO_META,
  canonicalKey,
  cleanUrl,
  isShortLink,
  oembedUrl,
  parseOembed,
  parsePageMeta,
  providerOf,
  type BacklogRecord,
  type LinkMeta,
  type Transition,
} from './backlog';

const USER_AGENT = 'Mozilla/5.0 (compatible; SRFamilyBot/1.0; +https://strangeramblings.com)';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The whole description — redirect, oEmbed, page — gets this long before the item is added without one. */
const DESCRIBE_BUDGET_MS = 6_000;

/** Everything a list could show: still to do, and done or dismissed in the last 30 days. */
export async function loadItems(now = new Date()): Promise<BacklogRecord[]> {
  const since = new Date(now.getTime() - FINISHED_DAYS * 86_400_000);
  return db
    .select()
    .from(familyBacklogItem)
    .where(
      or(
        eq(familyBacklogItem.status, 'new'),
        and(inArray(familyBacklogItem.status, ['done', 'dismissed']), gte(familyBacklogItem.updatedAt, since)),
      ),
    );
}

/** An item by id, or null — also for a malformed id and for a deleted item. */
export async function getItem(id: string): Promise<BacklogRecord | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db
    .select()
    .from(familyBacklogItem)
    .where(and(eq(familyBacklogItem.id, id), ne(familyBacklogItem.status, 'deleted')))
    .limit(1);
  return row ?? null;
}

/** The item already holding this link (not deleted), so a second share does not add it twice. */
export async function findByKey(key: string): Promise<BacklogRecord | null> {
  const [row] = await db
    .select()
    .from(familyBacklogItem)
    .where(and(eq(familyBacklogItem.canonicalUrl, key), ne(familyBacklogItem.status, 'deleted')))
    .limit(1);
  return row ?? null;
}

export type NewItem = Pick<BacklogRecord, 'kind' | 'url' | 'canonicalUrl' | 'provider' | 'title' | 'siteName' | 'thumbnailUrl' | 'note' | 'forEmail' | 'addedByEmail'>;

export async function createItem(values: NewItem): Promise<BacklogRecord> {
  const [row] = await db.insert(familyBacklogItem).values({ ...values, status: 'new' }).returning();
  return row;
}

/** Apply a transition only if the row still holds the status it was read in; null = it moved underneath us. */
export async function applyTransition(id: string, t: Transition, now = new Date()): Promise<BacklogRecord | null> {
  const [row] = await db
    .update(familyBacklogItem)
    .set({ ...t.patch, updatedAt: sql`greatest(${now.toISOString()}::timestamptz, date_trunc('milliseconds', ${familyBacklogItem.updatedAt}) + interval '1 millisecond')` })
    .where(and(eq(familyBacklogItem.id, id), eq(familyBacklogItem.status, t.from)))
    .returning();
  return row ?? null;
}

// ── Describing a link ───────────────────────────────────────────────────────

type Fetcher = typeof guardedPublicFetch;

/** Where a TikTok short link leads, or the link itself when it cannot be followed. */
export async function followShortLink(url: URL, fetcher: Fetcher = guardedPublicFetch): Promise<URL> {
  if (!isShortLink(url)) return url;
  try {
    const res = await fetcher(url.toString(), {
      headers: { 'User-Agent': USER_AGENT },
      timeoutMs: 4_000,
      maxRedirects: 5,
      readBody: () => false,
    });
    return new URL(res.finalUrl);
  } catch {
    return url;
  }
}

async function oembed(cleaned: string, fetcher: Fetcher): Promise<LinkMeta> {
  const endpoint = oembedUrl(cleaned);
  if (!endpoint) return NO_META;
  try {
    const res = await fetcher(endpoint, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      timeoutMs: 4_000,
      maxBytes: 64 * 1024,
      readBody: (status) => status >= 200 && status < 300,
    });
    if (!res.ok) return NO_META;
    return parseOembed(JSON.parse(Buffer.from(res.body).toString('utf8')), providerOf(new URL(cleaned)));
  } catch {
    return NO_META;
  }
}

async function page(cleaned: string, fetcher: Fetcher): Promise<LinkMeta> {
  try {
    const res = await fetcher(cleaned, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
      timeoutMs: 5_000,
      // The <head> is all we read; a page's metadata is in its first few hundred kB.
      maxBytes: 512 * 1024,
      readBody: (status, headers) => status >= 200 && status < 300 && /html/i.test(headers.get('content-type') ?? ''),
    });
    if (!res.ok || !res.body.byteLength) return NO_META;
    return parsePageMeta(Buffer.from(res.body).toString('utf8'), res.finalUrl);
  } catch {
    return NO_META;
  }
}

/** A link's title, site and picture — oEmbed where the site has one, then the page itself. Never throws. */
export async function describeLink(cleaned: string, fetcher: Fetcher = guardedPublicFetch): Promise<LinkMeta> {
  const work = (async () => {
    const first = await oembed(cleaned, fetcher);
    if (first.title && first.thumbnailUrl) return first;
    // A TikTok page is rendered in the browser: what a fetch gets is the
    // site's own "TikTok - Make Your Day" for every video. Better no title
    // (the shared caption, or the host, stands in) than that one.
    if (providerOf(new URL(cleaned)) === 'tiktok') return first;
    const second = await page(cleaned, fetcher);
    return {
      title: first.title ?? second.title,
      siteName: first.siteName ?? second.siteName,
      thumbnailUrl: first.thumbnailUrl ?? second.thumbnailUrl,
    };
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<LinkMeta>((resolve) => {
    timer = setTimeout(() => resolve(NO_META), DESCRIBE_BUDGET_MS);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** A shared link made ready to store: short link followed, cleaned, keyed. */
export async function prepareLink(url: URL, fetcher: Fetcher = guardedPublicFetch): Promise<{ url: string; key: string; target: URL }> {
  const target = await followShortLink(url, fetcher);
  const cleaned = cleanUrl(target);
  return { url: cleaned, key: canonicalKey(cleaned), target: new URL(cleaned) };
}
