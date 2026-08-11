import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { builderClient } from '$lib/jkai/builder-client';
import { sanitiseBuildPatch, mergeBudget } from '$lib/builds/settings';

export const GET: RequestHandler = async ({ params }) => {
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  if (!build) return json({ error: 'Not found' }, { status: 404 });
  const iterations = await db.select().from(jkaiIterations).where(eq(jkaiIterations.buildId, params.id)).orderBy(asc(jkaiIterations.number));
  return json({ ...build, iterations });
};

/**
 * Validation lives in `$lib/builds/settings` so the Controls panel offers
 * exactly the ranges this route enforces. Every field it accepts is one the
 * orchestrator re-reads at the top of each iteration, which is what makes these
 * live controls on a running build rather than creation-time options.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  if (!build) return json({ error: 'Not found' }, { status: 404 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: 'invalid body' }, { status: 400 });

  const patch = sanitiseBuildPatch(body);
  if (Object.keys(patch).length === 0) return json({ ok: true, noop: true });

  // The UI edits one budget field at a time; merge onto the stored config so a
  // single-field patch cannot erase the other caps.
  const updates: Record<string, unknown> = { ...patch, updatedAt: new Date() };
  if (patch.budgetConfig) {
    updates.budgetConfig = mergeBudget(
      build.budgetConfig as Record<string, unknown> | null,
      patch.budgetConfig,
    );
  }

  await db.update(jkaiBuilds).set(updates).where(eq(jkaiBuilds.id, params.id));
  return json({ ok: true, applied: Object.keys(patch) });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  if (!build) return json({ error: 'Not found' }, { status: 404 });

  // Stop the build if it's currently running so the orchestrator loop tears down cleanly.
  if (build.status === 'running') {
    try {
      await builderClient.stopBuild(params.id);
    } catch {
      // Ignore — we'll still delete the DB rows below.
    }
  }

  // jkai_iterations and jkai_logs cascade via FK onDelete: 'cascade'.
  await db.delete(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));

  return json({ ok: true });
};
