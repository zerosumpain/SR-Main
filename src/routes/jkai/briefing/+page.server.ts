import type { PageServerLoad } from './$types';
import { getCollectionBySlug, queryRecords } from '$lib/datastore';
import { getSetting } from '$lib/server/models/settings';
import { db } from '$lib/db';
import { workflows } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  BRIEFINGS_COLLECTION,
  SETTINGS_ENABLED_KEY,
  SETTINGS_TOPICS_KEY,
  BRIEFING_WORKFLOW_NAME,
  type BriefingData,
} from '$lib/briefing/types';

const OWNER = 'owner';

/** "0 7 * * 1-5" → "07:00 weekdays". Falls back to the raw expression. */
function describeCron(expr: string | null): string {
  if (!expr) return 'not scheduled';
  const [min, hour, , , dow] = expr.trim().split(/\s+/);
  if (!/^\d+$/.test(min) || !/^\d+$/.test(hour)) return expr;
  const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  const days =
    dow === '*' ? 'daily' : dow === '1-5' ? 'weekdays' : dow === '0,6' || dow === '6,0' ? 'weekends' : `days ${dow}`;
  return `${time} ${days}`;
}

// Owner-gated by hooks. The briefing is produced by the `canvas:morning-briefing`
// workflow, which writes every run into the `briefings` collection; this page is
// the detail surface behind the WhatsApp summary.
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

  const [wf] = await db
    .select({ id: workflows.id, trigger: workflows.trigger })
    .from(workflows)
    .where(eq(workflows.name, BRIEFING_WORKFLOW_NAME))
    .limit(1);

  const cron = (wf?.trigger as { config?: { expression?: string } } | null)?.config?.expression ?? null;

  return {
    briefings,
    enabled: (await getSetting<boolean>(SETTINGS_ENABLED_KEY)) !== false,
    topics: (await getSetting<string[]>(SETTINGS_TOPICS_KEY)) ?? [],
    workflowId: wf?.id ?? null,
    schedule: { display: describeCron(cron), expr: cron },
  };
};
