import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { identifyDevice } from '$lib/server/native-auth';
import { isOwnerEmail } from '$lib/server/native-handler';
import { loadMember } from '$lib/server/grants';
import { isRegistrant, withdrawRegistration } from '$lib/server/registration';

/**
 * DELETE /api/native/register — a registrant takes their request back from the
 * review screen: the request is deleted and every phone credential for the
 * email is revoked. Only a registrant may: a member or the owner is refused,
 * so this can never be a way to sign somebody out of the app they use.
 */
async function withdraw({ request }: Parameters<RequestHandler>[0]): Promise<Response> {
  const identity = await identifyDevice(request);
  if (!identity) return json({ error: 'Pair this iPhone again.' }, { status: 401 });
  const email = identity.ownerEmail;
  if (isOwnerEmail(email) || (await loadMember(email)) || !(await isRegistrant(email))) {
    return json({ error: 'There is no request to withdraw.' }, { status: 400 });
  }
  await withdrawRegistration(email);
  return json({ ok: true });
}

export const DELETE: RequestHandler = withdraw;
