import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { newsFavourites } from '$lib/db/schema';
import type { NewsStory } from './types';
import { NEWS_SOURCE_LABELS } from '$lib/constants/news-sources';

const LOCAL_OWNER_KEY = 'local-owner';

/** Resolve the signed-in owner, with one stable identity for the LAN review bypass. */
export async function newsOwnerKey(locals: App.Locals): Promise<string> {
  try {
    const session = await locals.auth();
    const email = session?.user?.email?.trim().toLowerCase();
    if (email) return email;
  } catch {
    // The owner-only route gate has already authenticated the request. The
    // local review bypass intentionally has no OAuth session to resolve.
  }
  return LOCAL_OWNER_KEY;
}

function storedStory(row: typeof newsFavourites.$inferSelect, rank: number): NewsStory {
  return {
    key: row.newsKey,
    source: row.source === 'ars-technica' ? 'ars-technica' : row.source === 'lobsters' ? 'lobsters' : 'hacker-news',
    sourceLabel: NEWS_SOURCE_LABELS[row.source as keyof typeof NEWS_SOURCE_LABELS] ?? 'Hacker News',
    id: row.storyId,
    title: row.title,
    url: row.url,
    discussionUrl: row.discussionUrl,
    domain: row.domain,
    author: row.author,
    publishedAt: row.publishedAt.toISOString(),
    score: row.score,
    commentCount: row.commentCount,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    summary: row.summary,
    rank,
  };
}

export async function listNewsFavourites(ownerKey: string): Promise<NewsStory[]> {
  const rows = await db
    .select()
    .from(newsFavourites)
    .where(eq(newsFavourites.ownerKey, ownerKey))
    .orderBy(desc(newsFavourites.createdAt));
  return rows.map((row, index) => storedStory(row, index + 1));
}

export async function countNewsFavourites(ownerKey: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(newsFavourites)
    .where(eq(newsFavourites.ownerKey, ownerKey));
  return Number(row?.count ?? 0);
}

export async function isNewsFavourite(ownerKey: string, newsKey: string): Promise<boolean> {
  const [row] = await db
    .select({ newsKey: newsFavourites.newsKey })
    .from(newsFavourites)
    .where(and(eq(newsFavourites.ownerKey, ownerKey), eq(newsFavourites.newsKey, newsKey)))
    .limit(1);
  return Boolean(row);
}

export async function toggleNewsFavourite(
  ownerKey: string,
  story: NewsStory,
): Promise<{ favourited: boolean; href: string }> {
  const removed = await db
    .delete(newsFavourites)
    .where(and(eq(newsFavourites.ownerKey, ownerKey), eq(newsFavourites.newsKey, story.key)))
    .returning({ newsKey: newsFavourites.newsKey });
  if (removed.length > 0) return { favourited: false, href: '/news?view=favourites' };

  await db
    .insert(newsFavourites)
    .values({
      ownerKey,
      newsKey: story.key,
      source: story.source,
      storyId: story.id,
      title: story.title,
      url: story.url,
      discussionUrl: story.discussionUrl,
      domain: story.domain,
      author: story.author,
      publishedAt: new Date(story.publishedAt),
      score: story.score,
      commentCount: story.commentCount,
      tags: story.tags,
      summary: story.summary,
    })
    .onConflictDoNothing({ target: [newsFavourites.ownerKey, newsFavourites.newsKey] });
  return { favourited: true, href: '/news?view=favourites' };
}
