import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { undoStore } from '$lib/blog/assistant/undo-store';
import { updatePostFields, replaceTags, getPostById } from '$lib/blog';

export const POST: RequestHandler = async ({ params, request }) => {
  const postId = Number(params.id);
  if (!Number.isFinite(postId)) throw error(400, 'invalid id');
  const body = await request.json().catch(() => ({}));
  const token = String(body.undoToken ?? '');
  const snap = undoStore.take(token);
  if (!snap || snap.postId !== postId) throw error(404, 'unknown or expired undo token');

  switch (snap.field) {
    case 'title':
      await updatePostFields(postId, { title: snap.previousValue as string });
      break;
    case 'excerpt':
      await updatePostFields(postId, { excerpt: snap.previousValue as string });
      break;
    case 'slug':
      await updatePostFields(postId, { slug: snap.previousValue as string });
      break;
    case 'tags':
      await replaceTags(postId, snap.previousValue as string[]);
      break;
    case 'content': {
      const v = snap.previousValue;
      if (typeof v === 'string') {
        await updatePostFields(postId, { content: v });
      } else if (v && typeof v === 'object') {
        const o = v as { content: string; contentFormat: 'html' | 'markdown' };
        await updatePostFields(postId, { content: o.content, contentFormat: o.contentFormat });
      }
      break;
    }
    case 'status': {
      const o = snap.previousValue as { status: 'draft' | 'published'; publishedAt: Date | null };
      await updatePostFields(postId, { status: o.status, publishedAt: o.publishedAt });
      break;
    }
    case 'coverImageAlt':
      await updatePostFields(postId, { coverImageAlt: (snap.previousValue as string | null) });
      break;
    default:
      throw error(400, `unsupported undo field: ${snap.field}`);
  }

  const post = await getPostById(postId);
  return json({ ok: true, post });
};
