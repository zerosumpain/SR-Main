// The family backlog — storage and the one network job: finding out what a
// shared link is called. The rules are in ./backlog (PURE).
//
// Every fetch goes through guardedPublicFetch: a shared link is a URL a
// family member typed into the server, so it is treated as hostile — public
// addresses only, every redirect re-checked, small bodies, short timeouts.
// A link that cannot be described is still added; the phone names it by host.

import { and, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { familyBacklogItem, familyBacklogPref, familyBacklogReaction } from '$lib/db/schema';
import { guardedPublicFetch } from '$lib/server/safe-fetch';
import { pushToEmails } from '$lib/server/push-devices';
import type { PushMessage } from '$lib/server/apns';
import { familyRoster, nameFromEmail } from './roster.server';
import {
  FINISHED_DAYS,
  digestItems,
  digestText,
  forYouText,
  londonDay,
  reactionText,
  type ReactionRecord,
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

export const BACKLOG_URL = 'sr://family/backlog';
export const BACKLOG_CATEGORY = 'family-backlog';

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

/** Record the family task an item became. */
export async function setTaskId(id: string, taskId: string): Promise<BacklogRecord | null> {
  const [row] = await db.update(familyBacklogItem).set({ taskId }).where(eq(familyBacklogItem.id, id)).returning();
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

// ── Reactions ──────────────────────────────────────────────────────────────

/** Every emoji on these items. */
export async function loadReactions(itemIds: string[]): Promise<ReactionRecord[]> {
  if (!itemIds.length) return [];
  return db
    .select({ itemId: familyBacklogReaction.itemId, email: familyBacklogReaction.email, emoji: familyBacklogReaction.emoji })
    .from(familyBacklogReaction)
    .where(inArray(familyBacklogReaction.itemId, itemIds));
}

/** Set (or, with null, take back) one person's emoji. True when it CHANGED — only a change is worth a push. */
export async function setReaction(itemId: string, email: string, emoji: string | null): Promise<boolean> {
  if (emoji === null) {
    const gone = await db
      .delete(familyBacklogReaction)
      .where(and(eq(familyBacklogReaction.itemId, itemId), eq(familyBacklogReaction.email, email)))
      .returning({ itemId: familyBacklogReaction.itemId });
    return gone.length > 0;
  }
  const changed = await db
    .insert(familyBacklogReaction)
    .values({ itemId, email, emoji })
    .onConflictDoUpdate({
      target: [familyBacklogReaction.itemId, familyBacklogReaction.email],
      set: { emoji, createdAt: new Date() },
      setWhere: sql`${familyBacklogReaction.emoji} <> ${emoji}`,
    })
    .returning({ itemId: familyBacklogReaction.itemId });
  return changed.length > 0;
}

// ── Pushes ─────────────────────────────────────────────────────────────────
//
// Deliberately few. Nobody is pushed because something was added to the list
// — a teenager sharing fifteen TikToks would make it noise. A push goes to the
// person something was shared FOR, to whoever shared it when somebody answers
// it with an emoji, and, to those who turned it on, once each evening.

async function nameOf(email: string): Promise<string> {
  const p = (await familyRoster()).find((x) => x.email === email);
  return p?.name ?? nameFromEmail(email);
}

function backlogPush(text: { title: string; body: string }, collapseId: string, itemId?: string): PushMessage {
  return {
    ...text,
    category: BACKLOG_CATEGORY,
    threadId: BACKLOG_CATEGORY,
    level: 'active',
    relevance: 0.4,
    collapseId,
    userInfo: { category: BACKLOG_CATEGORY, url: BACKLOG_URL, ...(itemId ? { itemId } : {}) },
  };
}

/** Shared for somebody else: tell them. Fire-and-forget; never throws. */
export async function notifyForYou(item: BacklogRecord, opts: { push?: typeof pushToEmails } = {}): Promise<number> {
  const push = opts.push ?? pushToEmails;
  try {
    if (!item.forEmail || item.forEmail === item.addedByEmail) return 0;
    const message = backlogPush(forYouText(await nameOf(item.addedByEmail), item), `backlog-${item.id}`, item.id);
    return (await push([item.forEmail], message)).sent;
  } catch (err) {
    console.warn('[backlog] for-you push failed', err);
    return 0;
  }
}

/** An emoji on somebody's share: tell whoever shared it. Fire-and-forget; never throws. */
export async function notifyReaction(item: BacklogRecord, reactorEmail: string, emoji: string, opts: { push?: typeof pushToEmails } = {}): Promise<number> {
  const push = opts.push ?? pushToEmails;
  try {
    if (item.addedByEmail === reactorEmail) return 0;
    const message = backlogPush(reactionText(await nameOf(reactorEmail), emoji, item), `backlog-react-${item.id}`, item.id);
    return (await push([item.addedByEmail], message)).sent;
  } catch (err) {
    console.warn('[backlog] reaction push failed', err);
    return 0;
  }
}

// ── The evening round-up ───────────────────────────────────────────────────

export async function getDigest(email: string): Promise<boolean> {
  const [row] = await db.select({ digest: familyBacklogPref.digest }).from(familyBacklogPref).where(eq(familyBacklogPref.email, email)).limit(1);
  return row?.digest ?? false;
}

export async function setDigest(email: string, on: boolean): Promise<void> {
  await db
    .insert(familyBacklogPref)
    .values({ email, digest: on })
    .onConflictDoUpdate({ target: familyBacklogPref.email, set: { digest: on, updatedAt: new Date() } });
}

export interface DigestRun {
  day: string;
  wanted: number;
  claimed: number;
  pushed: number;
}

/**
 * Once a London day: everyone who turned the round-up on hears what others
 * added in the last 24 hours that is still on the list. A person is CLAIMED
 * for the day before anything is sent (`digest_sent_on`), so two ticks in the
 * window — or two processes — send it once; one with nothing new is claimed
 * and sent nothing.
 */
export async function runDigest(now = new Date(), opts: { push?: typeof pushToEmails } = {}): Promise<DigestRun> {
  const push = opts.push ?? pushToEmails;
  const day = londonDay(now);
  const wanted = await db.select({ email: familyBacklogPref.email }).from(familyBacklogPref).where(eq(familyBacklogPref.digest, true));
  const claimed = await db
    .update(familyBacklogPref)
    .set({ digestSentOn: day })
    .where(and(eq(familyBacklogPref.digest, true), or(isNull(familyBacklogPref.digestSentOn), ne(familyBacklogPref.digestSentOn, day))))
    .returning({ email: familyBacklogPref.email });
  const run: DigestRun = { day, wanted: wanted.length, claimed: claimed.length, pushed: 0 };
  if (!claimed.length) return run;
  const since = new Date(now.getTime() - 86_400_000);
  const items = await loadItems(now);
  for (const { email } of claimed) {
    const text = digestText(digestItems(items, email, since));
    if (!text) continue;
    try {
      run.pushed += (await push([email], backlogPush(text, `backlog-digest-${day}`))).sent > 0 ? 1 : 0;
    } catch (err) {
      console.warn('[backlog] digest push failed', err);
    }
  }
  return run;
}
