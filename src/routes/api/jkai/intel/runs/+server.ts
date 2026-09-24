// History of the nightly intel sweep.
//
//   GET ?limit=   most recent runs, newest first, with per-stage counts,
//                 timings and the full text of anything that failed.
//
// Exists because the sweep previously reported itself as a count of errors in a
// journal line and nothing else, so a stage that had failed every night since
// it shipped was indistinguishable from one that had never been asked to run.
//
// Owner-gated by hooks.server.ts like every other /api/jkai route.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listIntelRuns, ensureIntelRunCollection, RUN_HISTORY_LIMIT } from '$lib/jkai/intel/run-log';
import { isGmailRollingEnabled, isIntelEngineEnabled } from '$lib/jkai/intel/engine';
import { isOwnerScope } from '$lib/jkai/intel/scope';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';

function readLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return RUN_HISTORY_LIMIT;
  return Math.min(Math.floor(n), RUN_HISTORY_LIMIT);
}

// The nightly sweep runs over every space and its log reports whole-corpus
// counts and raw stage errors, so it is the owner's, not a scoped read.
export const GET: RequestHandler = async (event) => {
  const { url } = event;
  if (!isOwnerScope(await resolveRequestScope(event))) {
    return json({ error: 'owner only' }, { status: 403 });
  }
  try {
    // A host that has never run a sweep has no collection yet; creating it here
    // means the panel renders "no runs recorded" rather than an error, which is
    // a different and much less alarming statement.
    await ensureIntelRunCollection();
    const runs = await listIntelRuns(readLimit(url.searchParams.get('limit')));
    return json({
      runs,
      engineEnabled: isIntelEngineEnabled(),
      gmailEnabled: isGmailRollingEnabled(),
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
};
