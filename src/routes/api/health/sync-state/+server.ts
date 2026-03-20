import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { healthSyncState } from '$lib/db/schema';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  const states = await db.select().from(healthSyncState);
  return json(states);
};
