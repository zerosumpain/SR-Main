import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { heartbeatPulses } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, url }) => {
  const limit = Math.min(200, Math.max(10, Number(url.searchParams.get('limit') ?? 50)));
  const rows = await db
    .select()
    .from(heartbeatPulses)
    .where(eq(heartbeatPulses.activityId, params.id))
    .orderBy(desc(heartbeatPulses.ts))
    .limit(limit);
  return json({ pulses: rows });
};
