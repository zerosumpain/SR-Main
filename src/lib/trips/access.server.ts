// src/lib/trips/access.server.ts
//
// Who may open a trip (D2): the owner only, until phase 5. Members and guests
// get the site's normal refusal — the hook already keeps them off /trips and
// /api/trips (neither is in `$lib/access/catalogue`, so both are owner-only),
// and this is the second lock, the one that says WHICH owner, because trips are
// keyed by `owner_email`.
//
// The dev-only LAN bypass (`isOwnerRequest`) has no session and so no email; it
// answers as the first allow-listed owner, which is the local preview's
// synthetic owner and never a real address in production (the bypass is
// `import.meta.env.DEV` only).

import { error, type RequestEvent } from '@sveltejs/kit';
import { getOwnerEmails, isOwnerEmail } from '$lib/server/access';
import { isOwnerRequest } from '$lib/server/owner';
import type { NativeIdentity } from '$lib/server/native-auth';
import type { NativeRole } from '$lib/server/native-handler';

export const NOT_YOURS = 'Trips are for the site owner.';

/** The owner's email for a web request, or null for anyone else. */
export async function webTripOwner(event: Pick<RequestEvent, 'locals' | 'getClientAddress'>): Promise<string | null> {
  if (event.locals.viewingAs) return null; // viewing the site as a member: refused as they would be
  let email = '';
  try {
    email = ((await event.locals.auth())?.user?.email ?? '').trim().toLowerCase();
  } catch {
    email = '';
  }
  if (email && isOwnerEmail(email)) return email;
  if (await isOwnerRequest(event)) return getOwnerEmails()[0]?.trim().toLowerCase() || null;
  return null;
}

/** As above, throwing the site's 403 for anyone but the owner. */
export async function requireTripOwner(event: Pick<RequestEvent, 'locals' | 'getClientAddress'>): Promise<string> {
  const owner = await webTripOwner(event);
  if (!owner) error(403, NOT_YOURS);
  return owner;
}

/** The phone lane: `withNativeAccess` has resolved the device; only an owner's phone gets trips. */
export function nativeTripOwner(identity: NativeIdentity, role: NativeRole): string | null {
  if (role !== 'owner') return null;
  const email = identity.ownerEmail.trim().toLowerCase();
  return isOwnerEmail(email) ? email : null;
}
