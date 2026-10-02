import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireResearchSession } from '$lib/deepdive/session-access.server';
import { issueShare, revokeShare } from '$lib/deepdive/share';

/**
 * Issue the run's share link. Only the token's hash is stored, so the raw
 * token is in this response and nowhere else. A run that already has a hashed
 * link answers 409 unless the body asks to `rotate` (which replaces the link;
 * the old one stops working). See $lib/deepdive/share.
 */
export const POST: RequestHandler = async (event) => {
  const { params, request } = event;
  const { session } = await requireResearchSession(event, params.id, 'write');
  const body = (await request.json().catch(() => null)) as { rotate?: unknown } | null;

  const result = await issueShare(session, { rotate: body?.rotate === true });
  if (result.status === 'exists') {
    return json(
      { error: 'This run already has a share link. Its token is shown only when it is created; rotate to issue a new one.', shared: true },
      { status: 409 },
    );
  }
  return json({ token: result.token });
};

export const DELETE: RequestHandler = async (event) => {
  const { params } = event;
  await requireResearchSession(event, params.id, 'write');
  await revokeShare(params.id);
  return json({ message: 'Share link removed' });
};
