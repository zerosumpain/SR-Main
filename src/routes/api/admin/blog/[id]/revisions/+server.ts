import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { blogPostRevisions } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';

// GET — list recent revisions for a post (newest first, capped at 30).
export const GET: RequestHandler = async ({ params }) => {
  const postId = Number(params.id);
  if (!Number.isFinite(postId)) throw error(400, 'invalid id');
  const rows = await db
    .select()
    .from(blogPostRevisions)
    .where(eq(blogPostRevisions.postId, postId))
    .orderBy(desc(blogPostRevisions.createdAt))
    .limit(30);
  return json({ revisions: rows });
};

// POST — capture a pre-change snapshot.
export const POST: RequestHandler = async ({ params, request }) => {
  const postId = Number(params.id);
  if (!Number.isFinite(postId)) throw error(400, 'invalid id');
  const body = (await request.json().catch(() => ({}))) as Partial<{
    proposalId: string;
    field: string;
    previousValue: unknown;
    reason: string;
  }>;
  const field = body.field;
  if (!field) throw error(400, 'field required');
  const previous =
    typeof body.previousValue === 'string'
      ? body.previousValue
      : JSON.stringify(body.previousValue ?? null);
  await db.insert(blogPostRevisions).values({
    postId,
    proposalId: body.proposalId ?? null,
    field,
    previousValue: previous,
    reason: body.reason ?? null,
  });
  return json({ ok: true });
};
