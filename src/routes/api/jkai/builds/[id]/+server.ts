import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { orchestrator } from '$lib/jkai/orchestrator';

export const GET: RequestHandler = async ({ params }) => {
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  if (!build) return json({ error: 'Not found' }, { status: 404 });
  const iterations = await db.select().from(jkaiIterations).where(eq(jkaiIterations.buildId, params.id)).orderBy(asc(jkaiIterations.number));
  return json({ ...build, iterations });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  if (!build) return json({ error: 'Not found' }, { status: 404 });

  // Stop the build if it's currently running so the orchestrator loop tears down cleanly.
  if (build.status === 'running') {
    try {
      await orchestrator.stopBuild(params.id);
    } catch {
      // Ignore — we'll still delete the DB rows below.
    }
  }

  // jkai_iterations and jkai_logs cascade via FK onDelete: 'cascade'.
  await db.delete(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));

  return json({ ok: true });
};
