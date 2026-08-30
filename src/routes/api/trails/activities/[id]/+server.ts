import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { activities, activitySegmentEfforts } from '$lib/db/schema';
import { ACTIVITY_TYPES, isKnownActivityType } from '$lib/trails/activity-meta';
import { invalidateDailyPlan } from '$lib/trails/coach-service';
import { invalidateHighlights } from '$lib/trails/highlights-service';
import { invalidateSegmentCorpus } from '$lib/trails/segments-service';
import { scheduleSegmentRebuild } from '$lib/trails/segments-service';
import type { RequestHandler } from './$types';

// Owner-gated by absence: /api/trails is not in PUBLIC_PATHS, so hooks.server.ts
// answers 401 without a session and 403 for a guest before this file runs.
//
// The two corrections the owner can make to a recording:
//
//  * excludedFromSegments — drop a bad trace out of segment analysis.
//  * typeOverride — a ride the watch logged as a walk.
//
// Neither touches `activity_type` itself. Ingest upserts that column on every
// sync, so a correction stored there would be clobbered the next time the phone
// posted; readers go through effectiveType() instead.

/** Both changes invalidate the segment corpus, so both drop the efforts. */
async function dropEfforts(id: string): Promise<number> {
  const removed = await db
    .delete(activitySegmentEfforts)
    .where(eq(activitySegmentEfforts.activityId, id))
    .returning({ id: activitySegmentEfforts.id });
  return removed.length;
}

export const PATCH: RequestHandler = async ({ params, request }) => {
  const id = params.id;
  if (!id) return json({ error: 'missing id' }, { status: 400 });

  const body = (await request.json().catch(() => null)) as {
    excludedFromSegments?: unknown;
    typeOverride?: unknown;
  } | null;
  if (!body || typeof body !== 'object') {
    return json({ error: 'expected a JSON body' }, { status: 400 });
  }

  const patch: { excludedFromSegments?: boolean; typeOverride?: string | null } = {};

  if ('excludedFromSegments' in body) {
    if (typeof body.excludedFromSegments !== 'boolean') {
      return json({ error: 'excludedFromSegments must be a boolean' }, { status: 400 });
    }
    patch.excludedFromSegments = body.excludedFromSegments;
  }

  if ('typeOverride' in body) {
    const raw = body.typeOverride;
    if (raw === null || (typeof raw === 'string' && raw.trim() === '')) {
      // Clearing the correction, not setting it to whitespace. Stored as NULL so
      // the SQL coalesce and effectiveType() can never disagree about it.
      patch.typeOverride = null;
    } else if (typeof raw === 'string' && isKnownActivityType(raw.trim())) {
      patch.typeOverride = raw.trim();
    } else {
      return json(
        { error: `typeOverride must be null or one of: ${ACTIVITY_TYPES.join(', ')}` },
        { status: 400 },
      );
    }
  }

  if (!Object.keys(patch).length) {
    return json({ error: 'nothing to change' }, { status: 400 });
  }

  const [updated] = await db
    .update(activities)
    .set(patch)
    .where(eq(activities.id, id))
    .returning({
      id: activities.id,
      activityType: activities.activityType,
      typeOverride: activities.typeOverride,
      excludedFromSegments: activities.excludedFromSegments,
    });

  if (!updated) return json({ error: 'not found' }, { status: 404 });

  // The efforts on record were measured against the OLD answer to both
  // questions, so they go now rather than at the end of the next rebuild — the
  // list must not show a stale "2nd fastest" on a row the owner just excluded.
  const effortsRemoved = await dropEfforts(id);
  invalidateHighlights();
  // The same correction re-partitions the segment corpus, so the memoised
  // bests and form windows in segments-service go with it.
  invalidateSegmentCorpus();
  // The plan is memoised for the day, and both corrections change what it would
  // propose: an exclusion removes efforts a target was ranked on, and a type
  // correction moves the outing into a different sport's history.
  invalidateDailyPlan();

  // Fire and forget, like ingest does: a rebuild takes seconds and the caller is
  // a click, not a cron. It coalesces concurrent requests into the current run
  // plus exactly one more.
  scheduleSegmentRebuild();

  return json({
    ok: true,
    activity: updated,
    effortsRemoved,
    rebuild: 'scheduled',
  });
};
