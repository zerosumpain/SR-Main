import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions, synthesisRuns } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { runSynthesis } from '$lib/deepdive/synthesis';
import type { SynthesisScope } from '$lib/deepdive/synthesis-scope';

export const POST: RequestHandler = async ({ params, request }) => {
  const [session] = await db
    .select({ id: researchSessions.id })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id));

  if (!session) {
    return json({ error: 'Session not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const rawScope = (body?.scope ?? {}) as SynthesisScope;

  // Normalise/whitelist scope fields so arbitrary client JSON can't reach the DB.
  const scope: SynthesisScope = {};
  if (Array.isArray(rawScope.factIds)) {
    scope.factIds = rawScope.factIds.filter((x): x is string => typeof x === 'string');
  }
  if (typeof rawScope.category === 'string') scope.category = rawScope.category;
  if (typeof rawScope.pinnedOnly === 'boolean') scope.pinnedOnly = rawScope.pinnedOnly;

  const [run] = await db
    .insert(synthesisRuns)
    .values({ sessionId: params.id, scope, status: 'running' })
    .returning({ id: synthesisRuns.id });

  // Fire-and-forget — do NOT await (mirrors startResearch in worker.ts).
  runSynthesis(params.id, run.id, scope).catch((err) => {
    console.error(`[deepdive] runSynthesis crashed for run ${run.id}:`, err);
  });

  return json({ runId: run.id }, { status: 201 });
};
