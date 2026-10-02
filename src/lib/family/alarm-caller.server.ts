// Who may use the family alarm: exactly the audience of the travel desk
// (`GET /api/native/family/forecast`) — the owner's phone, or a member holding
// Family Circle or Family Admin. Anyone else is refused.

import type { RequestEvent } from '@sveltejs/kit';
import type { NativeIdentity } from '$lib/server/native-auth';
import type { NativeRole } from '$lib/server/native-handler';
import { peopleViewerOf } from '$lib/home/presence/viewer';
import { familyCaller, type FamilyCaller } from './access.server';

export const NOT_FAMILY_ALARM = 'Your access does not include the family.';

export async function alarmCaller(
  event: RequestEvent,
  identity: NativeIdentity,
  role: NativeRole,
): Promise<(FamilyCaller & { owner: boolean }) | null> {
  // The request was made to look like the member signed in on the web, so the
  // page's own viewer check answers for them — as the forecast route does.
  const viewer = role === 'owner' ? { kind: 'owner' as const } : await peopleViewerOf(event);
  if (!viewer) return null;
  const caller = await familyCaller(event, identity, role);
  if (!caller) return null;
  return { ...caller, owner: role === 'owner' };
}
