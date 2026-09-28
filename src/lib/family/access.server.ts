// Who is asking, for the family routes under /api/native/family.
//
// `withNativeAccess('any', …)` has already decided the credential is good and,
// for a member or an owner viewing the app as one, set `locals.viewer` to that
// person. So the answer is the owner (a parent), or the member the viewer
// names with their family level read from the grants the gate just loaded.

import type { RequestEvent } from '@sveltejs/kit';
import { familyLevel } from '$lib/access/roles';
import type { NativeIdentity } from '$lib/server/native-auth';
import type { NativeRole } from '$lib/server/native-handler';

export interface FamilyCaller {
  email: string;
  parent: boolean;
}

export const NOT_FAMILY = 'Steps and tasks are for the family.';

export async function familyCaller(
  event: Pick<RequestEvent, 'locals'>,
  identity: NativeIdentity,
  role: NativeRole,
): Promise<FamilyCaller | null> {
  if (role === 'owner') return { email: identity.ownerEmail.trim().toLowerCase(), parent: true };
  const viewer = await event.locals.viewer;
  if (!viewer || viewer.kind !== 'member') return null;
  const level = familyLevel(viewer.grants);
  if (level === 'none') return null;
  return { email: viewer.email.trim().toLowerCase(), parent: level === 'parent' };
}
