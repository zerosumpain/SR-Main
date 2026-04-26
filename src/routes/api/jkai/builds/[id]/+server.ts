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

const PATCHABLE_FIELDS = new Set([
  'enforceDesignSystem',
  'thinkingLevel',
  'requireIterationApproval',
  'enabledToolsets',
  'modelProvider',
  'modelId',
]);

export const PATCH: RequestHandler = async ({ params, request }) => {
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, params.id));
  if (!build) return json({ error: 'Not found' }, { status: 404 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: 'invalid body' }, { status: 400 });

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(body)) {
    if (!PATCHABLE_FIELDS.has(k)) continue;
    if (k === 'thinkingLevel' && typeof v === 'string') {
      const allowed = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
      if (!allowed.has(v)) continue;
      updates[k] = v;
    } else if (k === 'enabledToolsets' && Array.isArray(v)) {
      updates[k] = v.filter((s) => typeof s === 'string');
    } else if (k === 'enforceDesignSystem' || k === 'requireIterationApproval') {
      updates[k] = Boolean(v);
    } else if ((k === 'modelProvider' || k === 'modelId') && typeof v === 'string' && v.length > 0) {
      updates[k] = v;
    }
  }

  if (Object.keys(updates).length === 1) return json({ ok: true, noop: true });

  await db.update(jkaiBuilds).set(updates).where(eq(jkaiBuilds.id, params.id));
  return json({ ok: true });
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
