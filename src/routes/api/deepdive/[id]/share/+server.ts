import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { requireResearchSession } from '$lib/deepdive/session-access.server';

export const POST: RequestHandler = async (event) => {
  const { params } = event;
  const { session } = await requireResearchSession(event, params.id, 'write');

  if (session.shareToken) {
    return json({ token: session.shareToken });
  }

  const token = randomUUID();
  await db
    .update(researchSessions)
    .set({ shareToken: token })
    .where(eq(researchSessions.id, params.id));

  return json({ token });
};

export const DELETE: RequestHandler = async (event) => {
  const { params } = event;
  await requireResearchSession(event, params.id, 'write');
  await db
    .update(researchSessions)
    .set({ shareToken: null })
    .where(eq(researchSessions.id, params.id));

  return json({ message: 'Share link removed' });
};
