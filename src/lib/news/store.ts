// Keeping the wire, and keeping what was read.
//
// Every write here is best-effort and logged rather than thrown. Nothing on the
// request path reads any of it back synchronously, so a failure should cost a
// gap in the history and nothing else — see the `void recordStories(...)` call
// in `sources.ts`.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { newsReads, newsStories } from '$lib/db/schema';
import type { NewsSource, NewsStory } from './types';

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
    await db
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
      });
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
