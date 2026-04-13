import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { integrations } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const [integration] = await db.select().from(integrations).where(eq(integrations.id, params.id));
  if (!integration) return json({ error: 'Not found' }, { status: 404 });
  return json(integration);
};

export const DELETE: RequestHandler = async ({ params }) => {
  await db.delete(integrations).where(eq(integrations.id, params.id));
  return json({ success: true });
};
