import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { authorize } from '../../../auth';

export const PATCH: RequestHandler = async ({ params, cookies, request, url }) => {
  if (!authorize(cookies, url)) return json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json();
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  if (!build) return json({ error: 'Not found' }, { status: 404 });
  const currentConfig = (build.budgetConfig || {}) as Record<string, any>;
  const newConfig = { ...currentConfig, ...body };
  await db.update(jkaiBuilds).set({ budgetConfig: newConfig, updatedAt: new Date() }).where(eq(jkaiBuilds.id, params.id));
  return json({ ok: true, budgetConfig: newConfig });
};
