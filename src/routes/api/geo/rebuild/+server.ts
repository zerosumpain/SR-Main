import { json } from '@sveltejs/kit';
import { isOwnerEmail } from '$lib/server/access';
import { ingestGeoTerritory, rollDailySnapshots } from '$lib/geo/service';
import type { RequestHandler } from './$types';

// GATED BY ABSENCE.
//
// /api/geo is in NONE of PUBLIC_PATHS (src/lib/auth.ts), PUBLIC_API_PATHS
// (src/lib/server/public-api-paths.ts) or the hook bypasses
// (src/lib/server/gate-bypasses.ts), so hooks.server.ts already requires an
// owner session before this file is reached: no session is 401, a guest session
// is 403. That is the entire gate, and it is the strongest kind available here
// because it needs no allow-list entry to keep working — a future refactor
// cannot accidentally "keep" a permission that was never written down.
//
// Unlike /api/trails/segments this route deliberately does NOT accept a
// maintenance secret. That endpoint needs one because it is in HOOK_BYPASSES
// for POST, so a box with no session can drive the first build after a deploy.
// Adding this route to that list to gain the same escape hatch would put a
// route that reads five people's movement history — three of them children —
// into the anonymously-reachable surface, in exchange for convenience the
// hourly heartbeat (Phase 3) provides anyway.
//
// The owner check below is defence in depth, not the gate. It is a re-read of
// the same session the hook already tested, and it is here because a single
// hooks.server.ts edit should not be able to open this quietly.

/** Ceiling on the snapshot backfill one call may do. */
const MAX_SNAPSHOT_DAYS = 400;

/**
 * Rebuild territory from the trail and the workout corpus.
 *
 * A POST, and kept a POST: it writes the ledger, and although every write is
 * idempotent it is not the sort of thing a GET should do because a browser
 * prefetched it. Same shape as the rebuildSegments precedent — a long-running
 * owner-triggered recompute that reports counts rather than streaming.
 *
 * Body (all optional):
 *   full        boolean   ignore the watermarks and read the whole corpus
 *   subjects    string[]  restrict to these trail subjects
 *   sinceDays   number    read from N days ago regardless of the watermark
 *   snapshots   boolean   also fill in any missing daily snapshots (default true)
 *   snapshotFrom string   `YYYY-MM-DD` — force the snapshot roll to recompute
 *                         from this day, even though it is already written
 *   workouts    boolean   include the Apple corpus (default true)
 *
 * The snapshot roll repairs itself: it reopens any day a capture event has
 * landed on since that day was snapshotted, which is what a rebuild after a
 * backfill IS. `snapshotFrom` is the manual override for the case the automatic
 * detection cannot see — a day whose rows were edited by hand, or a change to
 * the scoring itself, where the ledger has not moved but the answer has. It
 * exists because without it the only repair was a DELETE in psql.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const session = await locals.auth();
  if (!isOwnerEmail(session?.user?.email)) {
    return json({ error: 'unauthorised' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const subjects = Array.isArray(body.subjects)
    ? body.subjects.filter((s): s is string => typeof s === 'string' && s.length > 0)
    : undefined;

  const sinceDays = Number(body.sinceDays);
  const since = Number.isFinite(sinceDays)
    ? new Date(Date.now() - Math.max(0, Math.min(3650, sinceDays)) * 86_400_000)
    : undefined;

  try {
    const report = await ingestGeoTerritory({
      full: body.full === true,
      subjects: subjects?.length ? subjects : undefined,
      since,
      includeWorkouts: body.workouts !== false,
    });

    const snapshotFrom =
      typeof body.snapshotFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.snapshotFrom)
        ? body.snapshotFrom
        : undefined;

    const snapshots =
      body.snapshots === false
        ? { days: [], rows: 0, repairedFrom: null }
        : await rollDailySnapshots({ maxDays: MAX_SNAPSHOT_DAYS, from: snapshotFrom });

    return json({ ...report, snapshots });
  } catch (err) {
    console.error('[geo/rebuild] failed:', err);
    // Never the raw message. A Drizzle "Failed query" embeds every bound
    // parameter, which here means thousands of real GPS coordinates on screen —
    // the exact disclosure this whole feature's posture exists to prevent.
    return json({ error: 'Territory rebuild failed. See the server log.' }, { status: 500 });
  }
};
