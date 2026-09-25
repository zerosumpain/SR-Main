import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cleanupIntelligence } from '$lib/jkai/intel/cleanup.server';
import { ensureIntelRunCollection, recordIntelRun, localDayOf, type IntelRunData } from '$lib/jkai/intel/run-log';
import { isOwnerScope } from '$lib/jkai/intel/scope';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';

// Both methods inherit the owner gate for /api/jkai from hooks.server.ts.
//
// GET is the preview: the notes, entities and review list it names are the
// request's scope. POST applies, and the apply sweeps EVERY space by design
// (orphans and stale rows are corpus hygiene, not one reader's view), so it is
// owner-only — a member's request must never delete rows in the owner's graph.
export const GET: RequestHandler = async (event) =>
  json(await cleanupIntelligence({ scope: await resolveRequestScope(event) }));

export const POST: RequestHandler = async (event) => {
  if (!isOwnerScope(await resolveRequestScope(event))) {
    return json({ error: 'Cleanup is owner-only' }, { status: 403 });
  }
  const body = await event.request.json().catch(() => null);
  if (body?.action !== 'run') return json({ error: 'Expected action: run' }, { status: 400 });
  await ensureIntelRunCollection();
  const start = Date.now();
  const run: IntelRunData = {
    id: `cleanup:${crypto.randomUUID()}`, day: localDayOf(), trigger: 'manual',
    startedAt: new Date(start).toISOString(), status: 'running', stages: [],
  };
  await recordIntelRun(run);
  try {
    const result = await cleanupIntelligence({ apply: true });
    await recordIntelRun({ ...run, finishedAt: new Date().toISOString(), status: 'ok', totalMs: Date.now() - start,
      stages: [{ stage: 'cleanup', ok: true, counts: result.counts, ms: Date.now() - start }] });
    return json({ ...result, runId: run.id });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await recordIntelRun({ ...run, finishedAt: new Date().toISOString(), status: 'failed', totalMs: Date.now() - start,
      stages: [{ stage: 'cleanup', ok: false, error, ms: Date.now() - start }] });
    throw err;
  }
};
