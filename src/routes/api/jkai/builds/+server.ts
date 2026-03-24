import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { orchestrator } from '$lib/jkai/orchestrator';

export const GET: RequestHandler = async () => {
  const builds = await db.select().from(jkaiBuilds).orderBy(desc(jkaiBuilds.createdAt));
  return json(builds);
};

export const POST: RequestHandler = async ({ request }) => {
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

  try {
    await orchestrator.startBuild(build.id);
  } catch (err: any) {
    // Build record created but orchestrator failed to start — update status
    await db.update(jkaiBuilds).set({ status: 'failed' }).where(
      (await import('drizzle-orm')).eq(jkaiBuilds.id, build.id),
    );
    return json({ error: `Build created but failed to start: ${err.message}` }, { status: 500 });
  }

  return json(build, { status: 201 });
};
