import { getCollectionBySlug, getRecordByKey, queryRecords } from '$lib/datastore';
import { getSetting } from '$lib/server/models/settings';
import { db } from '$lib/db';
import { workflowNodes, workflows } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { BRIEFING_SOURCE_CATALOG } from '$lib/constants/briefing';
import { getBriefingProfile } from '$lib/server/briefing-profile';
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

/**
 * One day's briefing, by its record key — which is the local date, `YYYY-MM-DD`
 * (the `Build record + message` transform sets `record.id = briefing.date`).
 *
 * `null` rather than a throw for every "there is nothing here" case — a missing
 * collection, an unknown day — so the route can answer 404 once and the caller
 * never has to tell a datastore error apart from an absent record.
 */
export async function loadBriefingDay(id: string): Promise<BriefingData | null> {
  if (!id || !(await getCollectionBySlug(BRIEFINGS_COLLECTION))) return null;
  try {
    const record = await getRecordByKey(BRIEFINGS_COLLECTION, id, OWNER);
    return record.data as unknown as BriefingData;
  } catch {
    return null;
  }
}

/** The day strip: the newest briefings, thinnest shape that renders a link. */
export async function listBriefingDays(
  limit = 30,
): Promise<Array<{ id: string; title: string; startedAt: string; status: string }>> {
  if (!(await getCollectionBySlug(BRIEFINGS_COLLECTION))) return [];
  const { records } = await queryRecords(
    BRIEFINGS_COLLECTION,
    { sort: { field: 'createdAt', dir: 'desc' }, limit },
    OWNER,
  );
  return records
    .map((r) => {
      const day = r.data as unknown as BriefingData;
      return {
        id: day?.id ?? r.key ?? '',
        title: day?.title ?? '',
        startedAt: day?.startedAt ?? '',
        status: day?.status ?? '',
      };
    })
    .filter((day) => day.id);
}

// Owner-gated by hooks. The briefing is produced by the `canvas:morning-briefing`
// workflow, which writes every run into the `briefings` collection; this page is
// the detail surface behind the WhatsApp summary.
export async function loadBriefingDashboard() {
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
  const nodes = wf
    ? await db
        .select({ type: workflowNodes.type, config: workflowNodes.config })
        .from(workflowNodes)
        .where(eq(workflowNodes.workflowId, wf.id))
    : [];
  const profile = await getBriefingProfile();
  const nodeTypes = new Set(nodes.map((node) => node.type));
  const healthOps = new Set(
    nodes
      .filter((node) => node.type === 'health-query')
      .map((node) => String((node.config as Record<string, unknown>)?.operation ?? '')),
  );
  const weatherCount = nodes.filter((node) => node.type === 'weather-brief').length;

  const isDirectlyConnected = (key: string, nodeTypesForSource: string[]): boolean => {
    if (key === 'weather-home') return weatherCount >= 1;
    if (key === 'weather-here') return weatherCount >= 2;
    if (key === 'sleep' || key === 'readiness') return healthOps.has(key);
    return nodeTypesForSource.some((type) => nodeTypes.has(type));
  };

  const sourceCatalog = BRIEFING_SOURCE_CATALOG.map((source) => {
    const directlyConnected = isDirectlyConnected(source.key, source.nodeTypes);
    const genericConnected = nodes.some((node) => {
      if (node.type !== 'transform') return false;
      const expression = String((node.config as Record<string, unknown>)?.expression ?? '');
      return expression.includes('briefingSources') && expression.includes(source.key);
    });
    const connection: 'native' | 'connected' | 'available' | 'missing' = source.mode === 'native'
      ? 'native'
      : directlyConnected || genericConnected
        ? 'connected'
        : source.mode === 'extension'
          ? 'available'
          : 'missing';
    return {
      ...source,
      preference: profile.sources[source.key],
      connection,
    };
  });

  return {
    briefings,
    enabled: (await getSetting<boolean>(SETTINGS_ENABLED_KEY)) !== false,
    topics: (await getSetting<string[]>(SETTINGS_TOPICS_KEY)) ?? [],
    profile,
    sourceCatalog,
    workflowId: wf?.id ?? null,
    schedule: { display: describeCron(cron), expr: cron },
  };
}
