import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { blogPosts, blogPostTags } from '$lib/db/schema';
import { isBlogAuthorship } from '$lib/blog/authorship';
import { BODY_FONT_KEYS } from '$lib/blog/fonts';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

function isBodyFontKey(v: unknown): boolean {
  return typeof v === 'string' && (BODY_FONT_KEYS as readonly string[]).includes(v);
}

// GET /api/admin/blog/:id — get single post with tags
export const GET: RequestHandler = async ({ params }) => {

  const id = parseInt(params.id);
  if (isNaN(id)) return json({ error: 'Invalid ID' }, { status: 400 });

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
      authorship: blogPosts.authorship,
      previewToken: blogPosts.previewToken,
      status: blogPosts.status,
      publishedAt: blogPosts.publishedAt,
      createdAt: blogPosts.createdAt,
      updatedAt: blogPosts.updatedAt,
    })
    .from(blogPosts)
    .where(eq(blogPosts.id, id))
    .limit(1);
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
  const { title, slug, excerpt, content, status, tags, contentFormat, coverImageUrl, coverImageAlt, previewToken, authorship, bodyFont } = body;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (title !== undefined) updates.title = title;
  if (slug !== undefined) updates.slug = slug;
  if (excerpt !== undefined) updates.excerpt = excerpt;
  if (content !== undefined) updates.content = content;
  if (contentFormat !== undefined) updates.contentFormat = contentFormat;
  if (coverImageUrl !== undefined) updates.coverImageUrl = coverImageUrl;
  // `coverImageAlt` has existed on the table since 2026-08-19 and was written
  // by NOTHING: it was never destructured here and no UI sent it. Alt-text
  // coverage is a publish-gate check, so a dead column was quietly failing it.
  if (coverImageAlt !== undefined) updates.coverImageAlt = coverImageAlt;
  // Reject an unknown face rather than storing it: the renderer resolves an
  // unrecognised value to the default, so a typo would silently look like the
  // picker had done nothing.
  if (bodyFont !== undefined) {
    if (!isBodyFontKey(bodyFont)) return json({ error: 'invalid bodyFont' }, { status: 400 });
    updates.bodyFont = bodyFont;
  }
  if (previewToken !== undefined) updates.previewToken = previewToken;
  // Reject an unknown authorship outright rather than coercing it — a typo'd
  // value silently excluded from the voice corpus is worse than a 400.
  if (authorship !== undefined) {
    if (!isBlogAuthorship(authorship)) return json({ error: 'invalid authorship' }, { status: 400 });
    updates.authorship = authorship;
  }
  if (status !== undefined) {
    updates.status = status;
    // FIRST publish only. This used to stamp `publishedAt = now()` on every
    // publish, so re-publishing after an edit silently moved the post to the
    // top of the index and rewrote the date on the page. A post has one
    // publication date; later edits are edits.
    if (status === 'published') {
      const [existing] = await db
        .select({ publishedAt: blogPosts.publishedAt })
        .from(blogPosts)
        .where(eq(blogPosts.id, id))
        .limit(1);
      if (!existing?.publishedAt) updates.publishedAt = new Date();
    }
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
