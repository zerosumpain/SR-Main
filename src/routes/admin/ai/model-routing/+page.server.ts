import type { PageServerLoad } from './$types';
import { getCollectionBySlug } from '$lib/datastore';
import {
  loadAssignments,
  getRoutingConfig,
  isRoutingEnabled,
  listRuns,
  listEvents,
} from '$lib/routing/events';
import { isSelectionRunning } from '$lib/routing/run';
import { buildSuccessIndex, type ProfileModelStat } from '$lib/routing/success';
import {
  CRON_EXPR,
  CRON_TZ,
  RUNS_COLLECTION,
  EVENTS_COLLECTION,
  PROFILES,
  PROFILE_LABEL,
  PROFILE_BLURB,
  DEFAULT_CONFIG,
  PRICE_WEIGHT_CAP,
} from '$lib/routing/types';

// Owner-gated in hooks.server.ts. Reads tolerate the system collections not yet
// existing (the engine seeds them on boot / first run). Mutations go through the
// /api/admin/models/routing/* + /api/jkai/routing/* JSON routes.

export const load: PageServerLoad = async () => {
  const [enabled, assignments, config] = await Promise.all([
    isRoutingEnabled(),
    loadAssignments(),
    getRoutingConfig(),
  ]);

  const runsExist = await getCollectionBySlug(RUNS_COLLECTION);
  const eventsExist = await getCollectionBySlug(EVENTS_COLLECTION);
  const runs = runsExist ? await listRuns(20) : [];
  const events = eventsExist ? await listEvents(4000) : [];

  const index = buildSuccessIndex(events);
  const stats: ProfileModelStat[] = [...index.values()].sort(
    (a, b) => b.total - a.total || b.wilson - a.wilson,
  );
  const decidedCount = events.filter((e) => e.correctFirstTime != null).length;

  return {
    enabled,
    assignments,
    config,
    defaults: DEFAULT_CONFIG,
    priceWeightCap: PRICE_WEIGHT_CAP,
    running: isSelectionRunning(),
    schedule: { expr: CRON_EXPR, tz: CRON_TZ, display: '04:00 Europe/London' },
    runs,
    stats,
    eventCount: events.length,
    decidedCount,
    profiles: PROFILES.map((p) => ({ id: p, label: PROFILE_LABEL[p], blurb: PROFILE_BLURB[p] })),
  };
};
