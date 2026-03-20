import { db } from '$lib/db';
import { blogPosts } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import type { PostMeta } from './types';

export type { PostMeta } from './types';

export async function getAllPosts(): Promise<PostMeta[]> {
  const posts = await db
    .select({
      slug: blogPosts.slug,
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      publishedAt: blogPosts.publishedAt,
    })
    .from(blogPosts)
    .where(eq(blogPosts.status, 'published'))
    .orderBy(desc(blogPosts.publishedAt));

  return posts.map((p) => ({
    ...p,
    publishedAt: p.publishedAt?.toISOString() ?? null,
  }));
}
