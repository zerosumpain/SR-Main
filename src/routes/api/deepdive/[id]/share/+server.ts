import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export const POST: RequestHandler = async ({ params }) => {
  const [session] = await db
    .select({ id: researchSessions.id, shareToken: researchSessions.shareToken })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id));

  if (!session) {
    return json({ error: 'Session not found' }, { status: 404 });
  }

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

export const DELETE: RequestHandler = async ({ params }) => {
  await db
    .update(researchSessions)
    .set({ shareToken: null })
    .where(eq(researchSessions.id, params.id));

  return json({ message: 'Share link removed' });
};
