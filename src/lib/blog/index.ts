import { db } from '$lib/db';
import { blogPosts } from '$lib/db/schema';
import { desc, eq, and } from 'drizzle-orm';
import type { PostMeta, Post } from './types';

export type { PostMeta, Post } from './types';

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

export async function getPostBySlug(slug: string): Promise<Post | null> {
  const [post] = await db
    .select({
      slug: blogPosts.slug,
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      content: blogPosts.content,
      publishedAt: blogPosts.publishedAt,
    })
    .from(blogPosts)
    .where(and(eq(blogPosts.slug, slug), eq(blogPosts.status, 'published')))
    .limit(1);

  if (!post) return null;

  return {
    ...post,
    publishedAt: post.publishedAt?.toISOString() ?? null,
  };
}
