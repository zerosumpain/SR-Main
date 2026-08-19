import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { updatePostFields, replaceTags, getPostById } from '$lib/blog';
import { recordResolution } from '$lib/blog/assistant/resolution';
import { db } from '$lib/db';
import { blogPostRevisions } from '$lib/db/schema';

type Body = {
  proposalId: string;
  field: 'title' | 'excerpt' | 'slug' | 'tags' | 'status' | 'cover_alt';
  value: unknown;
  /** The model's stated justification, carried through to the resolution record. */
  reason?: string;
  /** What the model originally proposed, when the author edited it before
   *  accepting. Absent means `value` is the model's suggestion unchanged. */
  suggested?: unknown;
};

/** Meta values are unknown-typed (tags arrive as an array, status as a string).
 *  Flatten to the text form the resolution record stores. */
function asText(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

export const POST: RequestHandler = async ({ params, request }) => {
  const postId = Number(params.id);
  if (!Number.isFinite(postId)) throw error(400, 'invalid id');
  const body = (await request.json().catch(() => ({}))) as Partial<Body>;
  const field = body.field;
  if (!field) throw error(400, 'field required');
  const value = body.value;

  // Snapshot the previous value BEFORE applying so the user can roll back.
  const cur = await getPostById(postId);
  let previousValue: string | undefined;
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
    previousValue = prev;
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
    await recordResolution(postId, {
      id: body.proposalId,
      status: 'accepted',
      kind: 'meta',
      field,
      original: previousValue,
      suggested: asText(body.suggested !== undefined ? body.suggested : value),
      final: asText(value),
      reason: body.reason,
    });
  }

  const post = await getPostById(postId);
  return json({ ok: true, post });
};
