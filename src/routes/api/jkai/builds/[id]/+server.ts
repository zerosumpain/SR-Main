import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { authorize } from '../../auth';

export const GET: RequestHandler = async ({ params, cookies, url }) => {
  if (!authorize(cookies, url)) return json({ error: 'Unauthorized' }, { status: 401 });
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  if (!build) return json({ error: 'Not found' }, { status: 404 });
  const iterations = await db.select().from(jkaiIterations).where(eq(jkaiIterations.buildId, params.id)).orderBy(asc(jkaiIterations.number));
  return json({ ...build, iterations });
};
