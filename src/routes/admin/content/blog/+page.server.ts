import { db } from '$lib/db';
import { blogPosts } from '$lib/db/schema';
import { BLOG_AUTHORSHIP, type BlogAuthorship } from '$lib/blog/authorship';
import { desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { getUmami } from '$lib/umami/client';
import { plainTextFromHtml, countWords } from '$lib/blog/readability';

export const load: PageServerLoad = async () => {
  const posts = await db
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      status: blogPosts.status,
      authorship: blogPosts.authorship,
      coverImageUrl: blogPosts.coverImageUrl,
      publishedAt: blogPosts.publishedAt,
      createdAt: blogPosts.createdAt,
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

  // Corpus meter for the voice system: how much genuinely-human prose exists
  // to build a Voice Card from. Counted exactly rather than estimated — at
  // this scale it costs nothing, and the whole point of the authorship column
  // is that guessing is what got us here. Move this into the voice build
  // script once the corpus is large enough for the read to matter.
  const bodies = await db
    .select({ authorship: blogPosts.authorship, content: blogPosts.content })
    .from(blogPosts);

  const corpus = Object.fromEntries(
    BLOG_AUTHORSHIP.map((a) => [a, { posts: 0, words: 0 }]),
  ) as Record<BlogAuthorship, { posts: number; words: number }>;

  for (const row of bodies) {
    const bucket = corpus[row.authorship as BlogAuthorship] ?? corpus.unknown;
    bucket.posts += 1;
    bucket.words += countWords(plainTextFromHtml(row.content ?? ''));
  }

  return {
    posts: posts.map((p) => ({
      ...p,
      views7d: stats[`/blog/${p.slug}`]?.pageviews ?? null,
    })),
    corpus,
  };
};
