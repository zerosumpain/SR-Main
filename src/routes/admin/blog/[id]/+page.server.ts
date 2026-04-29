import { error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { blogPosts, blogPostTags } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { loadHistory } from '$lib/blog/assistant/messages';
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

  return { post: { ...post, tags: tags.map((t) => t.tag) }, history };
};
