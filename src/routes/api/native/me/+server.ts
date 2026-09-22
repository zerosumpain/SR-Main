import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';

/**
 * GET /api/native/me — is this token still good, and whose is it.
 *
 * The phone calls this on launch. It is deliberately the cheapest thing under
 * the lane: a 401 here is how the app learns to show the pairing screen again,
 * so it must not depend on the health of chat or the news wires.
 */
export const GET: RequestHandler = withDevice((_event, identity) => ({
  ownerEmail: identity.ownerEmail,
  label: identity.label,
  expiresAt: identity.expiresAt.toISOString(),
}));
