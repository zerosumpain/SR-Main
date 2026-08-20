import { error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { blogPosts, blogPostTags } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { loadHistory } from '$lib/blog/assistant/messages';
import { getVoiceCard } from '$lib/voice/card';
import { getUmami } from '$lib/umami/client';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const id = parseInt(params.id);
  if (isNaN(id)) throw error(400, 'Invalid ID');

  const [post] = await db
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      content: blogPosts.content,
      coverImageUrl: blogPosts.coverImageUrl,
      contentFormat: blogPosts.contentFormat,
      previewToken: blogPosts.previewToken,
      status: blogPosts.status,
      publishedAt: blogPosts.publishedAt,
      createdAt: blogPosts.createdAt,
      updatedAt: blogPosts.updatedAt,
    })
    .from(blogPosts)
    .where(eq(blogPosts.id, id))
    .limit(1);
  if (!post) throw error(404, 'Post not found');

  const tags = await db
    .select({ tag: blogPostTags.tag })
    .from(blogPostTags)
    .where(eq(blogPostTags.postId, id));

  const history = await loadHistory(post.id);

  const umami = getUmami();
  const path = `/blog/${post.slug}`;
  let stats30d: { pageviews: number; visitors: number } | null = null;
  let statsLifetime: { pageviews: number; visitors: number } | null = null;
  let daily: { date: string; count: number }[] = [];
  let referrers: { name: string; count: number }[] = [];
  if (umami) {
    [stats30d, statsLifetime, daily, referrers] = await Promise.all([
      umami.getStatsForPath(path, 30),
      umami.getStatsForPath(path, 365 * 5),
      umami.getDailyViews(path, 30),
      umami.getTopReferrers(path, 30, 5),
    ]);
  }

  return {
    post: { ...post, tags: tags.map((t) => t.tag) },
    history,
    // The editor scores in the browser as the author types, so the card travels
    // with the page rather than costing a request per keystroke.
    voiceCard: getVoiceCard(),
    stats: { stats30d, statsLifetime, daily, referrers, available: umami !== null },
  };
};
