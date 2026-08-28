import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createFileShare, listFileShares, revokeFileShare, SHARE_TTL_DAYS } from '$lib/file-shares';

// Owner-only by default: /api/files/* is not in PUBLIC_PATHS, so hooks.server.ts
// has already required an owner session by the time these handlers run. The
// owner may share ANY drive file — the agent-created restriction applies to the
// jkai tool path (see $lib/workflows/site-tools/tools/file-share.ts), not here.

/** The owner's share list. Never includes a token or a hash — only metadata. */
export const GET: RequestHandler = async () => {
  return json({ shares: await listFileShares(), ttlDays: SHARE_TTL_DAYS });
};

/**
 * Mint a link. The raw token is in the response ONCE and is not recoverable
 * afterwards; the caller is expected to copy it there and then.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const body = await request.json().catch(() => null);
  const fileId = typeof body?.fileId === 'string' ? body.fileId.trim() : '';
  if (!fileId) throw error(400, 'fileId is required');

  const session = await locals.auth();
  const createdBy = session?.user?.email ?? 'owner';

  try {
    const share = await createFileShare({
      fileId,
      createdBy,
      label: typeof body?.label === 'string' ? body.label : null,
      ttlDays: typeof body?.ttlDays === 'number' ? body.ttlDays : undefined,
    });
    return json(share, { status: 201 });
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : 'could not create share');
  }
};

/** Revoke by share id. Idempotent, so a double-click is not an error. */
export const DELETE: RequestHandler = async ({ url }) => {
  const id = url.searchParams.get('id')?.trim();
  if (!id) throw error(400, 'id is required');
  return json({ revoked: await revokeFileShare(id) });
};
