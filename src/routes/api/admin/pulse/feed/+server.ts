import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowRuns, workflows, scraperRunLog, healthSyncState } from '$lib/db/schema';
import { desc, inArray } from 'drizzle-orm';

/**
 * Unified recent-activity feed. Pulls the last N rows from each persistent
 * source, normalises into a common shape, sorts by ts desc.
 *
 * Shape:
 *   { ts, kind, source, summary, status?, durationMs?, link?, raw }
 *
 * Sources:
 *   - workflow_runs        kind = 'workflow.run'
 *   - scraper_run_log      kind = 'scraper.run'
 *   - health_sync_state    kind = 'health.sync'  (one row per service, not history)
 *
 * In-memory things (orchestrator jobs, follow-up queue) live on /live not here.
 */
export const GET: RequestHandler = async ({ url }) => {
  const limit = Math.min(200, Math.max(10, Number(url.searchParams.get('limit') ?? 100)));

  const runs = await db
    .select()
    .from(workflowRuns)
    .orderBy(desc(workflowRuns.startedAt))
    .limit(limit);

  const wfIds = Array.from(new Set(runs.map((r) => r.workflowId)));
  const wfs = wfIds.length
    ? await db.select({ id: workflows.id, name: workflows.name }).from(workflows).where(inArray(workflows.id, wfIds))
    : [];
  const nameById = Object.fromEntries(wfs.map((w) => [w.id, w.name]));

  const scrapers = await db
    .select()
    .from(scraperRunLog)
    .orderBy(desc(scraperRunLog.startedAt))
    .limit(limit);

  const syncs = await db.select().from(healthSyncState);

  type FeedItem = {
    ts: number;
    kind: string;
    source: string;
    summary: string;
    status: string | null;
    durationMs: number | null;
    link: string | null;
    raw: Record<string, unknown>;
  };

  const items: FeedItem[] = [];

  for (const r of runs) {
    const startedMs = r.startedAt ? new Date(r.startedAt).getTime() : 0;
    const completedMs = r.completedAt ? new Date(r.completedAt).getTime() : null;
    items.push({
      ts: completedMs ?? startedMs,
      kind: 'workflow.run',
      source: nameById[r.workflowId] ?? '(workflow)',
      summary: `${r.trigger} run — ${r.status}${r.error ? `: ${r.error.slice(0, 80)}` : ''}`,
      status: r.status,
      durationMs: completedMs ? completedMs - startedMs : null,
      link: `/jkai/canvas/${r.workflowId}`,
      raw: {
        runId: r.id,
        workflowId: r.workflowId,
        trigger: r.trigger,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        heartbeatAt: r.heartbeatAt,
        pausedAtNodeId: r.pausedAtNodeId,
        error: r.error,
      },
    });
  }

  for (const s of scrapers) {
    const startedMs = s.startedAt ? new Date(s.startedAt).getTime() : 0;
    const endedMs = s.endedAt ? new Date(s.endedAt).getTime() : null;
    items.push({
      ts: endedMs ?? startedMs,
      kind: 'scraper.run',
      source: s.profile,
      summary: `${s.success ? 'OK' : 'FAIL'} — ${s.url.slice(0, 80)}${s.error ? ` (${s.error.slice(0, 60)})` : ''}`,
      status: s.success ? 'success' : 'error',
      durationMs: endedMs ? endedMs - startedMs : null,
      link: null,
      raw: {
        url: s.url,
        profile: s.profile,
        pagesLoaded: s.pagesLoaded,
        workflowRunId: s.workflowRunId,
        error: s.error,
      },
    });
  }

  for (const sync of syncs) {
    items.push({
      ts: sync.lastSyncAt * 1000,
      kind: 'health.sync',
      source: sync.service,
      summary: `${sync.status}${sync.recordsSynced ? ` — ${sync.recordsSynced} records` : ''}${sync.errorMessage ? `: ${sync.errorMessage.slice(0, 80)}` : ''}`,
      status: sync.status,
      durationMs: null,
      link: '/admin/health',
      raw: {
        lastSyncAt: sync.lastSyncAt,
        lastSuccessfulSyncAt: sync.lastSuccessfulSyncAt,
        recordsSynced: sync.recordsSynced,
        errorMessage: sync.errorMessage,
      },
    });
  }

  items.sort((a, b) => b.ts - a.ts);

  return json({ items: items.slice(0, limit) });
};
