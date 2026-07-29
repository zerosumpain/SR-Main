import type { PageServerLoad } from './$types';
import {
  DatastoreError,
  getCollectionBySlug,
  getRecordByKey,
  queryRecords,
} from '$lib/datastore';
import { getSetting } from '$lib/server/models/settings';
import { getImprovementStatus } from '$lib/selfimprove/run';
import { COLLECTIONS, CRON_EXPR, CRON_TZ, SETTINGS_ENABLED_KEY } from '$lib/selfimprove/types';
import { db } from '$lib/db';
import { customTools } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';

// The improvement dashboard operates as the `owner` actor (page is owner-gated
// in hooks.server.ts). Server load reads via $lib/datastore directly; mutations
// go through the /api/admin/improvement/* JSON routes with ?token= (datastore /
// blog / access precedent). Every read tolerates the system collections not yet
// existing (the engine seeds them on boot / first run).

const OWNER = 'owner';

async function loadRuns() {
  if (!(await getCollectionBySlug(COLLECTIONS.improvementRuns))) return [];
  const { records } = await queryRecords(
    COLLECTIONS.improvementRuns,
    { sort: { field: 'createdAt', dir: 'desc' }, limit: 30 },
    OWNER,
  );
  return records.map((r) => ({ runId: r.key, createdAt: r.createdAt, data: r.data }));
}

async function loadInsights() {
  if (!(await getCollectionBySlug(COLLECTIONS.questionInsights))) return null;
  try {
    const rec = await getRecordByKey(COLLECTIONS.questionInsights, 'latest', OWNER);
    return rec.data;
  } catch (err) {
    if (err instanceof DatastoreError && err.code === 'not_found') return null;
    throw err;
  }
}

async function loadApis() {
  if (!(await getCollectionBySlug(COLLECTIONS.apiCatalog))) return [];
  const { records } = await queryRecords(
    COLLECTIONS.apiCatalog,
    { sort: { field: 'key', dir: 'asc' }, limit: 500 },
    OWNER,
  );
  return records.map((r) => ({ key: r.key, data: r.data, updatedAt: r.updatedAt }));
}

async function loadSelfBuiltTools() {
  const rows = await db
    .select()
    .from(customTools)
    .where(eq(customTools.createdBy, 'self-improvement'))
    .orderBy(desc(customTools.createdAt));
  return rows.map((t) => ({
    name: t.name,
    description: t.description,
    toolset: t.toolset,
    enabled: t.enabled,
    runCount: t.runCount,
    errorCount: t.errorCount,
    lastRunAt: t.lastRunAt,
    createdAt: t.createdAt,
  }));
}

/** The engine's durable idea queue — open items first, then most recently touched. */
async function loadBacklog() {
  if (!(await getCollectionBySlug(COLLECTIONS.backlog))) return [];
  const { records } = await queryRecords(
    COLLECTIONS.backlog,
    { sort: { field: 'updatedAt', dir: 'desc' }, limit: 200 },
    OWNER,
  );
  return records
    .map((r) => r.data as Record<string, unknown>)
    .sort((a, b) => Number(a.status !== 'open') - Number(b.status !== 'open'));
}

export const load: PageServerLoad = async () => {
  const [runs, insights, apis, tools, backlog, enabledSetting] = await Promise.all([
    loadRuns(),
    loadInsights(),
    loadApis(),
    loadSelfBuiltTools(),
    loadBacklog(),
    getSetting(SETTINGS_ENABLED_KEY),
  ]);

  return {
    // Kill-switch: unset (null) is treated as enabled by the engine; only an
    // explicit `false` pauses it.
    enabled: enabledSetting !== false,
    schedule: { expr: CRON_EXPR, tz: CRON_TZ, display: '03:30 Europe/London' },
    status: getImprovementStatus(),
    runs,
    insights,
    apis,
    tools,
    backlog,
  };
};
