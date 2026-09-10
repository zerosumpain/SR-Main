import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkMutation, failure, requirePolicyOwner } from '$lib/policy-analysis/server/access';
import { createShare, listShares, revokeShare } from '$lib/policy-analysis/server/shares';

export const GET: RequestHandler = async (event) => {
  const owner = await requirePolicyOwner(event);
  const shares = await listShares(owner, event.params.id);
  if (!shares) error(404, 'Analysis not found.');
  return json({ shares });
};

/**
 * Mint a link. The RAW token is returned once and never stored, so this is the
 * only moment the URL exists anywhere outside the recipient's hands.
 */
export const POST: RequestHandler = async (event) => {
  const owner = await requirePolicyOwner(event);
  checkMutation(event, owner);
  try {
    const body = await event.request.json().catch(() => ({}));
    const created = await createShare(owner, event.params.id, {
      label: typeof body.label === 'string' ? body.label : null,
      expiresInDays: typeof body.expiresInDays === 'number' ? body.expiresInDays : null,
    });
    return json({ ...created, url: new URL(`/policy-analysis/shared/${created.token}`, event.url.origin).href });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    return failure(err);
  }
};

export const DELETE: RequestHandler = async (event) => {
  const owner = await requirePolicyOwner(event);
  checkMutation(event, owner);
  try {
    const body = await event.request.json().catch(() => ({}));
    if (typeof body.shareId !== 'string' || !body.shareId) error(400, 'shareId is required.');
    const revoked = await revokeShare(owner, event.params.id, body.shareId);
    if (!revoked) error(404, 'Link not found.');
    return json({ revoked: true });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    return failure(err);
  }
};
