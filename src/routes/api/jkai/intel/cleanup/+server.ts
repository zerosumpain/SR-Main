import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cleanupIntelligence } from '$lib/jkai/intel/cleanup.server';
import { ensureIntelRunCollection, recordIntelRun, localDayOf, type IntelRunData } from '$lib/jkai/intel/run-log';

// Both methods inherit the owner gate for /api/jkai from hooks.server.ts.
export const GET: RequestHandler = async () => json(await cleanupIntelligence());

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
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
