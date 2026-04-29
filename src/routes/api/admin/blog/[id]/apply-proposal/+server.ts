import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { updatePostFields, replaceTags, getPostById } from '$lib/blog';
import { appendMessage } from '$lib/blog/assistant/messages';
import { db } from '$lib/db';
import { blogPostRevisions } from '$lib/db/schema';

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

  // Snapshot the previous value BEFORE applying so the user can roll back.
  const cur = await getPostById(postId);
  if (cur) {
    let prev: string;
    switch (field) {
      case 'title': prev = cur.title; break;
      case 'excerpt': prev = cur.excerpt; break;
      case 'slug': prev = cur.slug; break;
      case 'tags': prev = JSON.stringify(cur.tags ?? []); break;
      case 'status': prev = cur.status; break;
      case 'cover_alt': prev = (cur as { coverImageAlt?: string | null }).coverImageAlt ?? ''; break;
      default: prev = '';
    }
    await db.insert(blogPostRevisions).values({
      postId,
      proposalId: body.proposalId ?? null,
      field,
      previousValue: prev,
      reason: `assistant accepted: ${field}`,
    });
  }

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
