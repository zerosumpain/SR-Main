import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { integrations } from '$lib/db/schema';
import { desc } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
  const rows = await db.select().from(integrations).orderBy(desc(integrations.createdAt));
  return json(rows);
};
