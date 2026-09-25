// Keeping the wire, and keeping what was read.
//
// Every write here is best-effort and logged rather than thrown. Nothing on the
// request path reads any of it back synchronously, so a failure should cost a
// gap in the history and nothing else — see the `void recordStories(...)` call
// in `sources.ts`.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { newsReads, newsStories } from '$lib/db/schema';
import { getSetting, setSetting } from '$lib/server/models/settings';
import type { NewsSource, NewsStory } from './types';
import { emit as emitPlatformEvent } from '$lib/events/platform-bus';
import { newsItemPayload } from './item-event';

/**
 * Upsert today's gather.
 *
 * `firstSeenAt` is never updated, which is the whole point of the table — it is
 * the only record of when a story appeared. `score` and `commentCount` take the
 * GREATEST of stored and incoming: a story polled after it slides off the front
 * page reports fewer comments than it had at its peak, and the peak is the
 * interesting number.
 */
export async function recordStories(stories: readonly NewsStory[]): Promise<void> {
  if (stories.length === 0) return;
  // One row per key. A duplicate inside a single batch would make Postgres
  // reject the whole statement ("cannot affect row a second time"), and the
  // `best` view really can carry the same story twice before dedupe runs.
  const rows = [...new Map(stories.map((story) => [story.key, story])).values()].map((story) => ({
    newsKey: story.key,
    source: story.source,
    storyId: story.id,
    title: story.title,
    url: story.url,
    canonicalUrl: story.canonicalUrl,
    discussionUrl: story.discussionUrl,
    domain: story.domain,
    author: story.author,
    publishedAt: new Date(story.publishedAt),
    score: story.score,
    commentCount: story.commentCount,
    tags: story.tags,
    summary: story.summary,
  }));

  try {
    const written = await db
      .insert(newsStories)
      .values(rows)
      .onConflictDoUpdate({
        target: newsStories.newsKey,
        set: {
          title: sql`excluded.title`,
          score: sql`greatest(${newsStories.score}, excluded.score)`,
          commentCount: sql`greatest(${newsStories.commentCount}, excluded.comment_count)`,
          summary: sql`excluded.summary`,
          lastSeenAt: sql`now()`,
        },
      })
      // `xmax = 0` is Postgres's tell for a row this statement INSERTED rather
      // than updated through the conflict clause — i.e. a story never seen before.
      .returning({
        key: newsStories.newsKey,
        source: newsStories.source,
        title: newsStories.title,
        url: newsStories.url,
        domain: newsStories.domain,
        inserted: sql<boolean>`(xmax = 0)`,
      });
    const fresh = written.filter((r) => r.inserted);
    const payload = newsItemPayload(fresh.map((r) => ({ key: r.key, source: r.source, title: r.title, url: r.url, domain: r.domain })));
    if (payload) emitPlatformEvent('news.item', payload, { source: 'news-desk' });
  } catch (err) {
    console.error('[news] could not record the gather:', err instanceof Error ? err.message : err);
  }
}

/** Record that the owner opened a story in the reader. */
export async function recordRead(
  ownerKey: string,
  newsKey: string,
  source: NewsSource,
): Promise<void> {
  try {
    await db
      .insert(newsReads)
      .values({ ownerKey, newsKey, source })
      .onConflictDoUpdate({
        target: [newsReads.ownerKey, newsReads.newsKey],
        set: { readCount: sql`${newsReads.readCount} + 1`, readAt: sql`now()` },
      });
  } catch (err) {
    console.error('[news] could not record the read:', err instanceof Error ? err.message : err);
  }
}

/**
 * A visit closer together than this does not count as a new visit.
 *
 * Without it the tile is honest and useless: refresh twice in a minute and the
 * second load truthfully reports zero new stories, because you did in fact just
 * look. Holding the mark still for half an hour means the number stays stable
 * while you are actually reading, and resets when you come back later.
 */
const VISIT_GAP_MS = 30 * 60 * 1000;

/** One scalar per owner. `app_settings`, like the watchlist snapshot — a table
 *  for a single timestamp per person would be a table for nothing. */
function visitKey(ownerKey: string): string {
  return `news.lastVisit.${ownerKey}`;
}

export interface NewSinceVisit {
  count: number;
  /** When the owner previously looked. Null on a first-ever visit. */
  since: string | null;
}

/**
 * How many of the stories currently on the desk arrived since the owner last
 * looked — the thing the page has always claimed to show.
 *
 * **A story with no stored row counts as new.** That is not a fallback, it is
 * the correct answer twice over: a story the desk has never recorded has never
 * been seen, and it also makes this immune to the race with `recordStories`,
 * which is deliberately not awaited. Without that rule the first view of a
 * fresh gather would undercount to nearly zero.
 */
export async function newSinceLastVisit(
  ownerKey: string,
  stories: readonly NewsStory[],
): Promise<NewSinceVisit> {
  if (stories.length === 0) return { count: 0, since: null };
  try {
    const stored = await getSetting<string>(visitKey(ownerKey));
    const since = stored ? new Date(stored) : null;
    const sinceValid = since && Number.isFinite(since.getTime()) ? since : null;

    const rows = await db
      .select({ newsKey: newsStories.newsKey, firstSeenAt: newsStories.firstSeenAt })
      .from(newsStories)
      .where(inArray(newsStories.newsKey, stories.map((story) => story.key)));
    const firstSeen = new Map(rows.map((row) => [row.newsKey, row.firstSeenAt]));

    const count = stories.reduce((total, story) => {
      const seen = firstSeen.get(story.key);
      if (!seen) return total + 1;
      if (!sinceValid) return total + 1;
      return total + (seen > sinceValid ? 1 : 0);
    }, 0);

    if (!sinceValid || Date.now() - sinceValid.getTime() > VISIT_GAP_MS) {
      await setSetting(visitKey(ownerKey), new Date().toISOString());
    }
    return { count, since: sinceValid ? sinceValid.toISOString() : null };
  } catch (err) {
    console.error('[news] could not count new stories:', err instanceof Error ? err.message : err);
    return { count: 0, since: null };
  }
}

/** Story keys the owner has already opened, for the ones currently on the desk. */
export async function readKeysFor(
  ownerKey: string,
  newsKeys: readonly string[],
): Promise<Set<string>> {
  if (newsKeys.length === 0) return new Set();
  try {
    const rows = await db
      .select({ newsKey: newsReads.newsKey })
      .from(newsReads)
      .where(and(eq(newsReads.ownerKey, ownerKey), inArray(newsReads.newsKey, [...newsKeys])));
    return new Set(rows.map((row) => row.newsKey));
  } catch (err) {
    console.error('[news] could not load read state:', err instanceof Error ? err.message : err);
    return new Set();
  }
}
