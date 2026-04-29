import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { updatePostFields, replaceTags, getPostById } from '$lib/blog';
import { appendMessage } from '$lib/blog/assistant/messages';

type Body = {
  proposalId: string;
  field: 'title' | 'excerpt' | 'slug' | 'tags' | 'status' | 'cover_alt';
  value: unknown;
};

export const POST: RequestHandler = async ({ params, request }) => {
  const postId = Number(params.id);
  if (!Number.isFinite(postId)) throw error(400, 'invalid id');
  const body = (await request.json().catch(() => ({}))) as Partial<Body>;
  const field = body.field;
  if (!field) throw error(400, 'field required');
  const value = body.value;

  switch (field) {
    case 'title':
      await updatePostFields(postId, { title: String(value ?? '') });
      break;
    case 'excerpt':
      await updatePostFields(postId, { excerpt: String(value ?? '') });
      break;
    case 'slug':
      await updatePostFields(postId, { slug: String(value ?? '') });
      break;
    case 'tags':
      await replaceTags(postId, Array.isArray(value) ? value.map((t) => String(t)) : []);
      break;
    case 'status': {
      const status: 'draft' | 'published' = value === 'published' ? 'published' : 'draft';
      const fields: Parameters<typeof updatePostFields>[1] = { status };
      const cur = await getPostById(postId);
      if (status === 'published' && cur && !cur.publishedAt) {
        fields.publishedAt = new Date();
      }
      await updatePostFields(postId, fields);
      break;
    }
    case 'cover_alt':
      await updatePostFields(postId, { coverImageAlt: value === null ? null : String(value ?? '') });
      break;
    default:
      throw error(400, `unsupported field: ${field}`);
  }

  if (body.proposalId) {
    await appendMessage(
      postId, 'proposal_resolved',
      JSON.stringify({ id: body.proposalId, status: 'accepted' }),
    ).catch(() => undefined);
  }

  const post = await getPostById(postId);
  return json({ ok: true, post });
};
