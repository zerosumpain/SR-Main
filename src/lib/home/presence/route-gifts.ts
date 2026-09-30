// src/lib/home/presence/route-gifts.ts
//
// A saved route the owner sends to a family member's phone to walk. The route
// is copied at following precision, since the member cannot read it from
// Health later. Only someone in the household with an address — what their
// phone is paired as — can be sent one.

import { randomBytes } from 'node:crypto';
import { db } from '$lib/db';
import { routeGift } from '$lib/db/schema';
import { getNativeRoute } from '$lib/server/native-routes';
import { listMembers } from './members';

export async function sendRouteGift(routeId: string, toSubject: string): Promise<{ id: string } | { error: string; status: number }> {
  const member = (await listMembers()).find((m) => m.subject === toSubject);
  if (!member?.email) return { error: 'They are not on the app.', status: 404 };
  const route = await getNativeRoute(routeId);
  const id = `gift-${randomBytes(9).toString('base64url')}`;
  await db.insert(routeGift).values({
    id,
    toSubject,
    toEmail: member.email.toLowerCase(),
    routeId,
    route: route as unknown as Record<string, unknown>,
  });
  return { id };
}
