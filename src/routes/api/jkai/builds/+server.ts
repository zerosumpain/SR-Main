import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { orchestrator } from '$lib/jkai/orchestrator';
import { authorize } from '../auth';

export const GET: RequestHandler = async ({ cookies, url }) => {
  if (!authorize(cookies, url)) return json({ error: 'Unauthorized' }, { status: 401 });
  const builds = await db.select().from(jkaiBuilds).orderBy(desc(jkaiBuilds.createdAt));
  return json(builds);
};

export const POST: RequestHandler = async ({ cookies, request, url }) => {
  if (!authorize(cookies, url)) return json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json();
  const { prompt, title, budgetConfig } = body;
  if (!prompt || typeof prompt !== 'string') {
    return json({ error: 'prompt is required' }, { status: 400 });
  }
  const [build] = await db.insert(jkaiBuilds).values({
    title: title || null,
    prompt,
    budgetConfig: budgetConfig || {},
  }).returning();
  await orchestrator.startBuild(build.id);
  return json(build, { status: 201 });
};
