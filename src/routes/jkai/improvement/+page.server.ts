import type { PageServerLoad } from './$types';
import {
  DatastoreError,
  getCollectionBySlug,
  getRecordByKey,
  queryRecords,
} from '$lib/datastore';
import { getImprovementStatus } from '$lib/selfimprove/run';
import { COLLECTIONS, CRON_EXPR, CRON_TZ } from '$lib/selfimprove/types';
import type { ImprovementRunData, QuestionInsights, ToolAttemptData } from '$lib/selfimprove/types';

// Owner-gated by hooks (the whole /jkai area is owner-only). Server load reads
// the self-improvement audit trail via $lib/datastore as the `owner` actor and
// computes summary statistics. Every read tolerates a system collection not yet
// existing (they are seeded on engine boot / first run).

const OWNER = 'owner';

type RunRow = { runId: string; createdAt: string; data: ImprovementRunData };
type AttemptRow = { key: string; createdAt: string; data: ToolAttemptData };

async function loadRuns(): Promise<RunRow[]> {
  if (!(await getCollectionBySlug(COLLECTIONS.improvementRuns))) return [];
  const { records } = await queryRecords(
    COLLECTIONS.improvementRuns,
    { sort: { field: 'createdAt', dir: 'desc' }, limit: 50 },
    OWNER,
  );
  return records.map((r) => ({
    runId: r.key ?? r.id,
    createdAt: r.createdAt.toISOString(),
    data: r.data as unknown as ImprovementRunData,
  }));
}

async function loadAttempts(): Promise<AttemptRow[]> {
  if (!(await getCollectionBySlug(COLLECTIONS.toolAttempts))) return [];
  const { records } = await queryRecords(
    COLLECTIONS.toolAttempts,
    { sort: { field: 'createdAt', dir: 'desc' }, limit: 50 },
    OWNER,
  );
  return records.map((r) => ({
    key: r.key ?? r.id,
    createdAt: r.createdAt.toISOString(),
    data: r.data as unknown as ToolAttemptData,
  }));
}

async function loadInsights(): Promise<QuestionInsights | null> {
  if (!(await getCollectionBySlug(COLLECTIONS.questionInsights))) return null;
  try {
    const rec = await getRecordByKey(COLLECTIONS.questionInsights, 'latest', OWNER);
    return rec.data as unknown as QuestionInsights;
  } catch (err) {
    if (err instanceof DatastoreError && err.code === 'not_found') return null;
    throw err;
  }
}

async function loadApiStatus(): Promise<{ total: number; byStatus: Record<string, number> }> {
  if (!(await getCollectionBySlug(COLLECTIONS.apiCatalog))) return { total: 0, byStatus: {} };
  const { records } = await queryRecords(COLLECTIONS.apiCatalog, { limit: 500 }, OWNER);
  const byStatus: Record<string, number> = {};
  for (const r of records) {
    const s = String((r.data as { status?: string }).status ?? 'seeded');
    byStatus[s] = (byStatus[s] ?? 0) + 1;
  }
  return { total: records.length, byStatus };
}

const ACTION_KINDS = [
  'insight',
  'api_registered',
  'api_verified',
  'tool_created',
  'tool_rejected',
  'proposal',
] as const;

export const load: PageServerLoad = async () => {
  const [runs, attempts, insights, apiStatus] = await Promise.all([
    loadRuns(),
    loadAttempts(),
    loadInsights(),
    loadApiStatus(),
  ]);

  // ── Statistics (computed over the loaded window) ──────────────────────────
  const runStatusCounts: Record<string, number> = {};
  const actionKindCounts: Record<string, number> = Object.fromEntries(ACTION_KINDS.map((k) => [k, 0]));
  let totalCostUsd = 0;
  let totalLlmCalls = 0;
  for (const r of runs) {
    const d = r.data;
    runStatusCounts[d.status] = (runStatusCounts[d.status] ?? 0) + 1;
    totalCostUsd += Number(d.costUsd ?? 0);
    totalLlmCalls += Number(d.llmCalls ?? 0);
    for (const a of d.actions ?? []) {
      if (a.kind in actionKindCounts) actionKindCounts[a.kind] += 1;
    }
  }

  const toolsCreated = attempts.filter((a) => a.data.status === 'created').length;
  const toolsRejected = attempts.filter((a) => a.data.status === 'rejected').length;
  const toolTotal = toolsCreated + toolsRejected;

  const stats = {
    totalRuns: runs.length,
    runStatusCounts,
    lastRunAt: runs[0]?.createdAt ?? null,
    actionKindCounts,
    totalCostUsd: Number(totalCostUsd.toFixed(4)),
    avgCostUsd: runs.length ? Number((totalCostUsd / runs.length).toFixed(4)) : 0,
    totalLlmCalls,
    toolsCreated,
    toolsRejected,
    toolSuccessRate: toolTotal ? Math.round((toolsCreated / toolTotal) * 100) : null,
    apisTotal: apiStatus.total,
    apisByStatus: apiStatus.byStatus,
    apisAddedByEngine: (actionKindCounts.api_registered ?? 0) + (actionKindCounts.api_verified ?? 0),
    proposals: actionKindCounts.proposal ?? 0,
    insightsLogged: actionKindCounts.insight ?? 0,
  };

  return {
    runs,
    attempts,
    insights,
    stats,
    schedule: { expr: CRON_EXPR, tz: CRON_TZ, display: '03:30 Europe/London' },
    running: getImprovementStatus().running,
  };
};
