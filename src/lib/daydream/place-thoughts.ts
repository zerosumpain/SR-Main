// src/lib/daydream/place-thoughts.ts
//
// The daydream-thought half of places: closing questions about places that
// have since been named. Split from places.ts when location moved to
// $lib/home/presence (2026-09-26), because it writes daydream_thoughts and so
// belongs to the daydream engine, not to presence.

import { and, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces } from '$lib/db/schema';

/**
 * Close any open question about a place that now has a name.
 *
 * `confirmPlace` already does this for the place it just named, and that fast
 * path stays. This is the reconciler behind it, and it exists because the fast
 * path is a trigger: it only fires on the one code path, in the one process, at
 * the one moment. Anything that sets a label another way — a backfill, a repair
 * script, a merge, a future bulk import — leaves the question standing, and
 * nothing comes along afterwards to notice.
 *
 * Production showed the symptom before the cause was pinned down: six thoughts
 * still reading "What is this place you keep going to?" about places that had
 * been named hours earlier. Rather than guess which path skipped the trigger,
 * this makes the invariant true continuously — a named place has no open
 * question, whoever named it and however.
 *
 * `actioned` is protected in `persistCandidates`, so a later detect tick cannot
 * reopen what this closes.
 */
export async function reconcileNamedPlaceThoughts(): Promise<number> {
  const { daydreamThoughts } = await import('$lib/db/schema');
  const resolved = await db
    .update(daydreamThoughts)
    .set({ status: 'actioned', updatedAt: new Date() })
    .where(
      and(
        inArray(daydreamThoughts.status, ['new', 'delivered', 'seen', 'suppressed']),
        sql`${daydreamThoughts.placeId} in (
          select ${daydreamPlaces.id} from ${daydreamPlaces}
          where ${daydreamPlaces.label} is not null
        )`,
      ),
    )
    .returning({ id: daydreamThoughts.id });
  return resolved.length;
}
