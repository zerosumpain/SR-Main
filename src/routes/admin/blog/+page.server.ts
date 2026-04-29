import { db } from '$lib/db';
import { blogPosts } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { getUmami } from '$lib/umami/client';

export const load: PageServerLoad = async () => {
  const posts = await db
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      title: blogPosts.title,
      status: blogPosts.status,
      coverImageUrl: blogPosts.coverImageUrl,
      publishedAt: blogPosts.publishedAt,
      updatedAt: blogPosts.updatedAt,
    })
    .from(blogPosts)
    .orderBy(desc(blogPosts.updatedAt));

  const umami = getUmami();
  let stats: Record<string, { pageviews: number; visitors: number }> = {};
  if (umami) {
    const paths = posts.map((p) => `/blog/${p.slug}`);
    stats = await umami.getStatsBatch(paths, 7);
  }

  return {
    posts: posts.map((p) => ({
      ...p,
      views7d: stats[`/blog/${p.slug}`]?.pageviews ?? null,
    })),
  };
};
