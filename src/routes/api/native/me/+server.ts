import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
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
export const GET: RequestHandler = withNativeAccess('any', async (_event, identity, role) => {
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
