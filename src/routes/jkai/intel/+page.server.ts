import type { PageServerLoad } from './$types';
import { getIntelStats, listNotes, listEntityTypes } from '$lib/jkai/intel/queries';
import { db } from '$lib/db';
import { intelAlerts, intelTimelineEvents } from '$lib/db/schema';
import { desc, eq, gte, asc } from 'drizzle-orm';
import { seedEntityTypes } from '$lib/jkai/intel/seed';

export const load: PageServerLoad = async () => {
  await seedEntityTypes();

  const [stats, recentNotes, recentAlerts, upcomingTimeline, entityTypes] = await Promise.all([
    getIntelStats(),
    listNotes({ limit: 5 }),
    db
      .select()
      .from(intelAlerts)
      .where(eq(intelAlerts.dismissed, false))
      .orderBy(desc(intelAlerts.createdAt))
      .limit(5),
    db
      .select()
      .from(intelTimelineEvents)
      .where(gte(intelTimelineEvents.date, new Date().toISOString().split('T')[0]))
      .orderBy(asc(intelTimelineEvents.date))
      .limit(5),
    listEntityTypes(),
  ]);

  return { stats, recentNotes, recentAlerts, upcomingTimeline, entityTypes };
};
