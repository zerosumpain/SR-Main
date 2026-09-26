// src/lib/home/presence/my-day.ts
//
// Whose day "Your day" is. The section on /home/people/[subject] and the
// endpoint that feeds it (/api/home/people/my-day) both ask this, and both
// answer from the SESSION alone: the endpoint takes no subject and no email,
// so there is nothing a viewer can change to read somebody else's day.
//
// - A household viewer (family:circle with a household row): their own email
//   and subject. A Family Admin's wards do NOT count — the day is read off the
//   viewer's own phone account, and a guardian's phone is not their child's.
// - The owner: their session email, and the household row that email is on
//   (if any). In dev the LAN bypass has no session, so the box previews as the
//   first owner email — `isOwnerRequest` never passes a sessionless request in
//   a production build.
// - Anyone else: null.

import { getOwnerEmails } from '$lib/server/access';
import { householdSubjectFor } from '$lib/server/members';
import type { OwnerCheckEvent } from '$lib/server/owner';
import { peopleViewerOf } from './viewer';

export interface OwnDay {
  /** Lower-cased; the pilot account the day is read from. */
  email: string;
  /** Their household subject, or null when their email is on no household row. */
  subject: string | null;
}

export async function ownDayOf(event: OwnerCheckEvent): Promise<OwnDay | null> {
  const viewer = await peopleViewerOf(event);
  if (!viewer) return null;
  const session = await event.locals.auth().catch(() => null);
  let email = (session?.user?.email ?? '').trim().toLowerCase();
  if (!email && viewer.kind === 'owner') email = (getOwnerEmails()[0] ?? '').trim().toLowerCase();
  if (!email) return null;
  if (viewer.kind === 'household') return { email, subject: viewer.subject };
  const subject = await householdSubjectFor(email).catch(() => null);
  return { email, subject };
}
