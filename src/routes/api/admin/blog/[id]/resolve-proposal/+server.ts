import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordResolution } from '$lib/blog/assistant/resolution';

// POST /api/admin/blog/:id/resolve-proposal
//
// Records what the author did with a proposal — including the rejections that
// were previously thrown away entirely. Prose proposals are applied in the
// browser (RichEditor mutates the document directly), so unlike the meta-field
// flow there is no server round-trip that could record the decision as a side
// effect. This endpoint is that record.
//
// Owner-auth is enforced for the whole /api/admin/* tree in hooks.server.ts.

type Body = {
  proposalId: string;
  status: 'accepted' | 'rejected';
  kind?: 'prose' | 'meta';
  field?: string;
  original?: string;
  suggested?: string;
  final?: string;
  reason?: string;
};

export const POST: RequestHandler = async ({ params, request }) => {
  const postId = Number(params.id);
  if (!Number.isFinite(postId)) throw error(400, 'invalid id');

  const body = (await request.json().catch(() => ({}))) as Partial<Body>;
  if (!body.proposalId) throw error(400, 'proposalId required');
  if (body.status !== 'accepted' && body.status !== 'rejected') {
    throw error(400, 'status must be accepted or rejected');
  }

  await recordResolution(postId, {
    id: body.proposalId,
    status: body.status,
    kind: body.kind === 'meta' ? 'meta' : 'prose',
    field: body.field,
    original: body.original,
    suggested: body.suggested,
    final: body.final,
    reason: body.reason,
  });

  return json({ ok: true });
};
