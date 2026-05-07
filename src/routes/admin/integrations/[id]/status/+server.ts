import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { integrationCredentials } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const rows = await db
    .select({
      lastTestedAt: integrationCredentials.lastTestedAt,
      lastTestStatus: integrationCredentials.lastTestStatus,
      lastTestError: integrationCredentials.lastTestError,
    })
    .from(integrationCredentials)
    .where(eq(integrationCredentials.id, params.id))
    .limit(1);
  if (rows.length === 0) throw error(404, 'Not found');
  return json(rows[0]);
};
