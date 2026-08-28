import { json } from '@sveltejs/kit';
import { listSegments, rebuildSegments } from '$lib/trails/segments-service';
import { isMaintenanceAuthorized } from '$lib/server/maintenance-auth';
import type { RequestHandler } from './$types';

// Owner-gated by absence: /api/trails is not in PUBLIC_PATHS, so hooks.server.ts
// requires the owner session. A GPS trace starts at the front door, and a
// segment is that trace with a name on it.

export const GET: RequestHandler = async ({ url }) => {
  const types = url.searchParams.get('types');
  return json(
    await listSegments({
      types: types ? types.split(',').filter(Boolean) : undefined,
    }),
  );
};

/**
 * Recompute every segment.
 *
 * Kept a POST, and kept explicit: a rebuild rewrites the whole set, and
 * although names survive it through geometric reconciliation, it is not the
 * sort of thing a GET should ever do by accident.
 *
 * Two callers: the owner from a browser, and a one-off run from the box
 * carrying the maintenance secret — the latter is how the first build gets
 * done after a deploy, with no session to speak of. hooks.server.ts lets that
 * pair through for POST only; this re-checks it, defence in depth.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!(await isMaintenanceAuthorized(request, locals))) {
    return json({ error: 'unauthorised' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  const options: Parameters<typeof rebuildSegments>[0] = {};
  if (Number.isFinite(body?.minLengthM)) {
    options.minLengthM = Math.max(100, Math.min(20_000, Number(body.minLengthM)));
  }
  if (Number.isFinite(body?.toleranceM)) {
    options.toleranceM = Math.max(5, Math.min(100, Number(body.toleranceM)));
  }
  if (Number.isFinite(body?.minEfforts)) {
    options.minEfforts = Math.max(2, Math.min(50, Number(body.minEfforts)));
  }

  try {
    return json(await rebuildSegments(options));
  } catch (err) {
    console.error('[trails/segments] rebuild failed:', err);
    // Never the raw message: a Drizzle "Failed query" embeds every bound
    // parameter, which here means thousands of coordinates on screen.
    return json({ error: 'Segment rebuild failed. See the server log.' }, { status: 500 });
  }
};
