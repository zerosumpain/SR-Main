import { db } from '$lib/db';
import { blogPosts, blogPostTags } from '$lib/db/schema';
import type { BlogAuthorship } from './authorship';
import { eq, desc, and } from 'drizzle-orm';
import type { PostMeta, Post } from './types';

export type { PostMeta, Post } from './types';
import { DEFAULT_BODY_FONT } from './fonts';

export async function getAllPosts(): Promise<PostMeta[]> {
  const posts = await db
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      coverImageUrl: blogPosts.coverImageUrl,
      coverImageAlt: blogPosts.coverImageAlt,
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
    coverImageAlt: p.coverImageAlt ?? null,
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
      coverImageAlt: blogPosts.coverImageAlt,
      contentFormat: blogPosts.contentFormat,
      bodyFont: blogPosts.bodyFont,
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
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    content: post.content,
    coverImageUrl: post.coverImageUrl,
    coverImageAlt: post.coverImageAlt ?? null,
    tags: tagRows.map((t) => t.tag),
    contentFormat: post.contentFormat as 'html' | 'markdown',
    bodyFont: post.bodyFont ?? DEFAULT_BODY_FONT,
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
      coverImageAlt: blogPosts.coverImageAlt,
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
    coverImageAlt: p.coverImageAlt ?? null,
    tags: tagMap.get(p.id) ?? [],
    publishedAt: p.publishedAt?.toISOString() ?? null,
  }));
}

export async function getPostById(id: number) {
  const [row] = await db.select().from(blogPosts).where(eq(blogPosts.id, id));
  if (!row) return null;
  const tags = await db
    .select({ tag: blogPostTags.tag })
    .from(blogPostTags)
    .where(eq(blogPostTags.postId, id));
  return { ...row, tags: tags.map((t) => t.tag) };
}

export async function updatePostFields(
  id: number,
  fields: Partial<{
    title: string;
    excerpt: string;
    slug: string;
    content: string;
    contentFormat: 'html' | 'markdown';
    coverImageUrl: string | null;
    coverImageAlt: string | null;
    status: 'draft' | 'published';
    publishedAt: Date | null;
    previewToken: string;
    authorship: BlogAuthorship;
  }>,
) {
  await db
    .update(blogPosts)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(blogPosts.id, id));
}

export async function replaceTags(postId: number, tags: string[]) {
  await db.delete(blogPostTags).where(eq(blogPostTags.postId, postId));
  if (tags.length === 0) return;
  await db.insert(blogPostTags).values(tags.map((tag) => ({ postId, tag })));
}

export async function isSlugTaken(slug: string, exceptId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: blogPosts.id })
    .from(blogPosts)
    .where(eq(blogPosts.slug, slug));
  return !!row && row.id !== exceptId;
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
      coverImageAlt: blogPosts.coverImageAlt,
      contentFormat: blogPosts.contentFormat,
      bodyFont: blogPosts.bodyFont,
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
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    content: post.content,
    coverImageUrl: post.coverImageUrl,
    coverImageAlt: post.coverImageAlt ?? null,
    tags: tagRows.map((t) => t.tag),
    contentFormat: post.contentFormat as 'html' | 'markdown',
    bodyFont: post.bodyFont ?? DEFAULT_BODY_FONT,
    previewToken: post.previewToken ?? '',
    publishedAt: post.publishedAt?.toISOString() ?? null,
  };
}
