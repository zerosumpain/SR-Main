import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identifyDevice } from '$lib/server/native-auth';
import { isOwnerEmail } from '$lib/server/native-handler';
import { VIEW_AS_HEADER } from '$lib/server/native-gate';
import { eraseAccount, OWNER_REFUSAL } from '$lib/people/erase';

/**
 * DELETE /api/native/account — the iPhone app's "Delete account" (App Store
 * guideline 5.1.1(v)). The phone's own person is deleted: access, phones on
 * both lanes, requests, and their data here and on the companion server
 * ($lib/people/erase says exactly what, and what stays).
 *
 * Its own gate rather than `withNativeAccess`: a member who has lost every
 * grant, and a registrant still waiting, must both be able to delete what
 * they have — the app's member gate would refuse them.
 *
 * Refused: the OWNER (never deletable from a phone — their account is the
 * site's configuration), and any request made while viewing as someone
 * (view-as is look-only; this would delete the person being viewed).
 */
export const DELETE: RequestHandler = async ({ request }) => {
  const identity = await identifyDevice(request);
  if (!identity) return json({ error: 'Pair this iPhone again.' }, { status: 401 });
  if (request.headers.get(VIEW_AS_HEADER) !== null) {
    return json({ error: 'View as is look-only: exit it to make changes.' }, { status: 403 });
  }
  if (isOwnerEmail(identity.ownerEmail)) return json({ error: OWNER_REFUSAL }, { status: 403 });

  const outcome = await eraseAccount(identity.ownerEmail);
  if (!outcome.ok) return json({ error: outcome.error }, { status: outcome.status });
  return json({ ok: true, warnings: outcome.warnings });
};
