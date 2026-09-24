import type { PageServerLoad } from './$types';
import { getIntelStats, listNotes, listEntityTypes } from '$lib/jkai/intel/queries';
import { db } from '$lib/db';
import { intelAlerts, intelTimelineEvents } from '$lib/db/schema';
import { and, desc, eq, gte, asc } from 'drizzle-orm';
import { seedEntityTypes } from '$lib/jkai/intel/seed';
import { spaceIn } from '$lib/jkai/intel/scope';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';

export const load: PageServerLoad = async (event) => {
  await seedEntityTypes();
  const scope = await resolveRequestScope(event);

  const [stats, recentNotes, recentAlerts, upcomingTimeline, entityTypes] = await Promise.all([
    getIntelStats(scope),
    listNotes({ limit: 5, scope }),
    db
      .select()
      .from(intelAlerts)
      .where(and(eq(intelAlerts.dismissed, false), spaceIn(intelAlerts.spaceId, scope)))
      .orderBy(desc(intelAlerts.createdAt))
      .limit(5),
    db
      .select()
      .from(intelTimelineEvents)
      .where(
        and(
          gte(intelTimelineEvents.date, new Date().toISOString().split('T')[0]),
          spaceIn(intelTimelineEvents.spaceId, scope),
        ),
      )
      .orderBy(asc(intelTimelineEvents.date))
      .limit(5),
    // The shared type vocabulary, not rows: unscoped.
    listEntityTypes(),
  ]);

  return { stats, recentNotes, recentAlerts, upcomingTimeline, entityTypes };
};
