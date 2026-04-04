import { db } from '$lib/db';
import { blogPosts, blogPostTags } from '$lib/db/schema';
import { eq, desc, and } from 'drizzle-orm';
import type { PostMeta, Post } from './types';

export type { PostMeta, Post } from './types';

export async function getAllPosts(): Promise<PostMeta[]> {
  const posts = await db
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      coverImageUrl: blogPosts.coverImageUrl,
      publishedAt: blogPosts.publishedAt,
    })
    .from(blogPosts)
    .where(eq(blogPosts.status, 'published'))
    .orderBy(desc(blogPosts.publishedAt));

  // Fetch all tags for published posts in one query
  const tags = await db
    .select({
      postId: blogPostTags.postId,
      tag: blogPostTags.tag,
    })
    .from(blogPostTags)
    .innerJoin(blogPosts, eq(blogPostTags.postId, blogPosts.id))
    .where(eq(blogPosts.status, 'published'));

  // Build a map of postId -> tags[]
  const tagMap = new Map<number, string[]>();
  for (const t of tags) {
    const existing = tagMap.get(t.postId) ?? [];
    existing.push(t.tag);
    tagMap.set(t.postId, existing);
  }

  return posts.map((p) => ({
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    coverImageUrl: p.coverImageUrl,
    tags: tagMap.get(p.id) ?? [],
    publishedAt: p.publishedAt?.toISOString() ?? null,
  }));
}

export async function getPostBySlug(slug: string): Promise<Post | null> {
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
      publishedAt: blogPosts.publishedAt,
    })
    .from(blogPosts)
    .where(and(eq(blogPosts.slug, slug), eq(blogPosts.status, 'published')))
    .limit(1);

  if (!post) return null;

  // Fetch tags for this post
  const tagRows = await db
    .select({ tag: blogPostTags.tag })
    .from(blogPostTags)
    .where(eq(blogPostTags.postId, post.id));

  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    content: post.content,
    coverImageUrl: post.coverImageUrl,
    tags: tagRows.map((t) => t.tag),
    contentFormat: post.contentFormat as 'html' | 'markdown',
    previewToken: post.previewToken ?? '',
    publishedAt: post.publishedAt?.toISOString() ?? null,
  };
}

export async function getPostsByTag(tag: string): Promise<PostMeta[]> {
  const posts = await db
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      coverImageUrl: blogPosts.coverImageUrl,
      publishedAt: blogPosts.publishedAt,
    })
    .from(blogPosts)
    .innerJoin(blogPostTags, eq(blogPosts.id, blogPostTags.postId))
    .where(and(eq(blogPosts.status, 'published'), eq(blogPostTags.tag, tag)))
    .orderBy(desc(blogPosts.publishedAt));

  // Deduplicate posts (a post might appear multiple times if it has the same tag twice)
  const seen = new Set<number>();
  const unique = posts.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  // Fetch all tags for these post IDs
  const postIds = unique.map((p) => p.id);
  let tagMap = new Map<number, string[]>();
  if (postIds.length > 0) {
    const allTags = await db
      .select({
        postId: blogPostTags.postId,
        tag: blogPostTags.tag,
      })
      .from(blogPostTags)
      .innerJoin(blogPosts, eq(blogPostTags.postId, blogPosts.id))
      .where(eq(blogPosts.status, 'published'));

    for (const t of allTags) {
      if (postIds.includes(t.postId)) {
        const existing = tagMap.get(t.postId) ?? [];
        existing.push(t.tag);
        tagMap.set(t.postId, existing);
      }
    }
  }

  return unique.map((p) => ({
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    coverImageUrl: p.coverImageUrl,
    tags: tagMap.get(p.id) ?? [],
    publishedAt: p.publishedAt?.toISOString() ?? null,
  }));
}

export async function getPostByPreviewToken(token: string): Promise<Post | null> {
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
      publishedAt: blogPosts.publishedAt,
    })
    .from(blogPosts)
    .where(eq(blogPosts.previewToken, token))
    .limit(1);

  if (!post) return null;

  // Fetch tags for this post
  const tagRows = await db
    .select({ tag: blogPostTags.tag })
    .from(blogPostTags)
    .where(eq(blogPostTags.postId, post.id));

  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    content: post.content,
    coverImageUrl: post.coverImageUrl,
    tags: tagRows.map((t) => t.tag),
    contentFormat: post.contentFormat as 'html' | 'markdown',
    previewToken: post.previewToken ?? '',
    publishedAt: post.publishedAt?.toISOString() ?? null,
  };
}
