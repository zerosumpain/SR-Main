import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { blogPosts, blogPostTags } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

// GET /api/admin/blog/:id — get single post with tags
export const GET: RequestHandler = async ({ params }) => {

  const id = parseInt(params.id);
  if (isNaN(id)) return json({ error: 'Invalid ID' }, { status: 400 });

  const [post] = await db.select().from(blogPosts).where(eq(blogPosts.id, id)).limit(1);
  if (!post) return json({ error: 'Not found' }, { status: 404 });

  const tags = await db
    .select({ tag: blogPostTags.tag })
    .from(blogPostTags)
    .where(eq(blogPostTags.postId, id));

  return json({ ...post, tags: tags.map((t) => t.tag) });
};

// PUT /api/admin/blog/:id — update post
export const PUT: RequestHandler = async ({ request, params }) => {

  const id = parseInt(params.id);
  if (isNaN(id)) return json({ error: 'Invalid ID' }, { status: 400 });

  const body = await request.json();
  const { title, slug, excerpt, content, status, tags } = body;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (title !== undefined) updates.title = title;
  if (slug !== undefined) updates.slug = slug;
  if (excerpt !== undefined) updates.excerpt = excerpt;
  if (content !== undefined) updates.content = content;
  if (status !== undefined) {
    updates.status = status;
    if (status === 'published') updates.publishedAt = new Date();
  }

  const [post] = await db.update(blogPosts).set(updates).where(eq(blogPosts.id, id)).returning();
  if (!post) return json({ error: 'Not found' }, { status: 404 });

  if (tags !== undefined) {
    await db.delete(blogPostTags).where(eq(blogPostTags.postId, id));
    if (tags.length) {
      await db.insert(blogPostTags).values(tags.map((tag: string) => ({ postId: id, tag })));
    }
  }

  return json(post);
};

// DELETE /api/admin/blog/:id — delete post
export const DELETE: RequestHandler = async ({ params }) => {

  const id = parseInt(params.id);
  if (isNaN(id)) return json({ error: 'Invalid ID' }, { status: 400 });

  await db.delete(blogPosts).where(eq(blogPosts.id, id));
  return json({ ok: true });
};
