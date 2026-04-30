import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { blogPostRevisions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { updatePostFields, replaceTags, getPostById } from '$lib/blog';

export const POST: RequestHandler = async ({ params }) => {
  const postId = Number(params.id);
  const revId = Number(params.revId);
  if (!Number.isFinite(postId) || !Number.isFinite(revId)) throw error(400, 'invalid id');

  const [rev] = await db
    .select()
    .from(blogPostRevisions)
    .where(eq(blogPostRevisions.id, revId));
  if (!rev || rev.postId !== postId) throw error(404, 'revision not found');

  const value = rev.previousValue;
  // For tags / arrays we stored JSON-encoded; everything else is raw text.
  switch (rev.field) {
    case 'content':
      await updatePostFields(postId, { content: value });
      break;
    case 'title':
      await updatePostFields(postId, { title: value });
      break;
    case 'excerpt':
      await updatePostFields(postId, { excerpt: value });
      break;
    case 'slug':
      await updatePostFields(postId, { slug: value });
      break;
    case 'tags': {
      let parsed: string[] = [];
      try { parsed = JSON.parse(value) as string[]; } catch { parsed = []; }
      await replaceTags(postId, Array.isArray(parsed) ? parsed : []);
      break;
    }
    case 'status': {
      const status: 'draft' | 'published' = value === 'published' ? 'published' : 'draft';
      await updatePostFields(postId, { status });
      break;
    }
    case 'cover_alt':
      await updatePostFields(postId, { coverImageAlt: value || null });
      break;
    default:
      throw error(400, `unsupported field for rollback: ${rev.field}`);
  }

  // Once consumed, drop the revision row so a second rollback doesn't
  // resurrect the same value.
  await db.delete(blogPostRevisions).where(eq(blogPostRevisions.id, revId));

  const post = await getPostById(postId);
  return json({ ok: true, post });
};
