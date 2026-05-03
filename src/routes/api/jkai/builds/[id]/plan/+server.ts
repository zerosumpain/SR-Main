import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { builderClient } from '$lib/jkai/builder-client';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const buildId = params.id!;
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
  if (!build) throw error(404, 'not found');
  const [iter0] = await db
    .select()
    .from(jkaiIterations)
    .where(and(eq(jkaiIterations.buildId, buildId), eq(jkaiIterations.number, 0)))
    .limit(1);
  return json({
    status: build.status,
    planStatus: build.planStatus,
    plan: iter0?.plan ?? null,
    milestones: build.milestones ?? [],
  });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const buildId = params.id!;
  const body = (await request.json().catch(() => null)) as
    | { action?: string; plan?: string; prompt?: string }
    | null;
  if (!body || typeof body.action !== 'string') throw error(400, 'action required');
  try {
    if (body.action === 'approve') {
      await builderClient.approvePlan(buildId);
    } else if (body.action === 'skip') {
      await builderClient.skipPlan(buildId);
    } else if (body.action === 'replan') {
      await builderClient.replan(buildId, body.prompt);
    } else if (body.action === 'edit') {
      await builderClient.editPlan(buildId, String(body.plan ?? ''));
    } else {
      throw error(400, `unknown action: ${body.action}`);
    }
    return json({ ok: true });
  } catch (e: any) {
    if (e?.status) throw e;
    throw error(400, e?.message ?? 'plan action failed');
  }
};
