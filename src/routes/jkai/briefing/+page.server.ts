import type { PageServerLoad } from './$types';
import { getCollectionBySlug, queryRecords } from '$lib/datastore';
import { getSetting } from '$lib/server/models/settings';
import { isBriefingRunning } from '$lib/briefing/run';
import {
  BRIEFINGS_COLLECTION,
  SETTINGS_ENABLED_KEY,
  SETTINGS_TOPICS_KEY,
  CRON_EXPR,
  CRON_TZ,
  type BriefingData,
} from '$lib/briefing/types';

const OWNER = 'owner';

// Owner-gated by hooks. Reads past briefings + config from the datastore.
export const load: PageServerLoad = async () => {
  let briefings: BriefingData[] = [];
  if (await getCollectionBySlug(BRIEFINGS_COLLECTION)) {
    const { records } = await queryRecords(
      BRIEFINGS_COLLECTION,
      { sort: { field: 'createdAt', dir: 'desc' }, limit: 30 },
      OWNER,
    );
    briefings = records.map((r) => r.data as unknown as BriefingData);
  }

  const enabled = (await getSetting<boolean>(SETTINGS_ENABLED_KEY)) !== false;
  const topics = (await getSetting<string[]>(SETTINGS_TOPICS_KEY)) ?? [];

  return {
    briefings,
    enabled,
    topics,
    running: isBriefingRunning(),
    schedule: { display: '06:30 Europe/London', expr: CRON_EXPR, tz: CRON_TZ },
  };
};
