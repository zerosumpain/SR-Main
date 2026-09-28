import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess, isOwnerEmail } from '$lib/server/native-handler';
import { identifyDevice } from '$lib/server/native-auth';
import { loadMember } from '$lib/server/grants';
import { registrationOf } from '$lib/server/registration';
import { appAccessForEmail } from '$lib/server/app-access';
import { peopleViewerForEmail } from '$lib/home/presence/viewer';

/**
 * GET /api/native/me — is this token still good, whose is it, and what may it
 * show.
 *
 * The phone calls this on launch. It is deliberately the cheapest thing under
 * the lane: a 401 here is how the app learns to show the pairing screen again,
 * so it must not depend on the health of chat or the news wires.
 *
 * `role` and `access` are how a member's phone learns which tabs to draw. They
 * are the same flags the household push carries (`$lib/server/app-access`),
 * minus the pairing code, which only ever travels that way. Any member may ask
 * — `withNativeAccess('any')` — because "you hold nothing here any more" is
 * itself an answer the app needs, and it gets it as a 403.
 */
const memberAnswer = withNativeAccess('any', async (_event, identity, role) => {
  const family = (await peopleViewerForEmail(identity.ownerEmail)) !== null;
  const { access } = await appAccessForEmail(identity.ownerEmail, family);
  return {
    ownerEmail: identity.ownerEmail,
    label: identity.label,
    expiresAt: identity.expiresAt.toISOString(),
    role,
    access,
  };
});

/**
 * A phone that signed in from the app's Welcome screen and holds no grants yet
 * is a REGISTRANT ($lib/server/registration): this is the one route it may
 * call, and the answer is where its request stands. Approved with nothing at
 * all is answered as a member who may use nothing, so the app leaves the
 * review screen rather than waiting on a yes that already happened.
 */
async function meOrRegistrant(event: Parameters<RequestHandler>[0]): Promise<Response> {
  const identity = await identifyDevice(event.request);
  if (identity && !isOwnerEmail(identity.ownerEmail)) {
    const member = await loadMember(identity.ownerEmail).catch(() => undefined);
    if (member === null) {
      const registration = await registrationOf(identity.ownerEmail).catch(() => null);
      if (registration?.status === 'pending' || registration?.status === 'declined') {
        return json({
          role: 'registrant',
          status: registration.status,
          name: registration.name,
          email: registration.email,
        });
      }
      if (registration?.status === 'approved') {
        return json({ ownerEmail: identity.ownerEmail, role: 'member', access: { owner: false } });
      }
    }
  }
  return memberAnswer(event);
}

export const GET: RequestHandler = meOrRegistrant;
