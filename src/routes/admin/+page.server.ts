import { hasToken } from '$lib/health-sync/tokens';
import { db } from '$lib/db';
import {
  healthSyncState,
  healthSyncJobs,
  blogPosts,
  agentActions,
  customTools,
  scraperCredentials,
  gmailAccounts,
  workflowFiles,
} from '$lib/db/schema';
import { desc, sql, gte, eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    whoopConnected,
    syncStates,
    activeJobs,
    blogStats,
    fileCount,
    gmailAcctCount,
    scraperCredCount,
    customToolStats,
    todayCost,
  ] = await Promise.all([
    hasToken('whoop').catch(() => false),
    db.select().from(healthSyncState).catch(() => []),
    db
      .select()
      .from(healthSyncJobs)
      .where(sql`status in ('queued', 'running')`)
      .orderBy(desc(healthSyncJobs.startedAt))
      .limit(5)
      .catch(() => []),
    db
      .select({ status: blogPosts.status, n: sql<number>`count(*)` })
      .from(blogPosts)
      .groupBy(blogPosts.status)
      .catch(() => []),
    db
      .select({ n: sql<number>`count(*)` })
      .from(workflowFiles)
      .catch(() => [{ n: 0 }]),
    db
      .select({ n: sql<number>`count(*)` })
      .from(gmailAccounts)
      .catch(() => [{ n: 0 }]),
    db
      .select({ n: sql<number>`count(*)` })
      .from(scraperCredentials)
      .catch(() => [{ n: 0 }]),
    db
      .select({
        total: sql<number>`count(*)`,
        enabled: sql<number>`count(*) filter (where ${customTools.enabled} = true)`,
      })
      .from(customTools)
      .catch(() => [{ total: 0, enabled: 0 }]),
    db
      .select({
        cost: sql<number>`coalesce(sum(${agentActions.costUsd}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(agentActions)
      .where(gte(agentActions.createdAt, todayStart))
      .catch(() => [{ cost: 0, count: 0 }]),
  ]);

  const blogCounts = {
    draft: 0,
    published: 0,
  };
  for (const row of blogStats) {
    if (row.status === 'draft') blogCounts.draft = Number(row.n) || 0;
    if (row.status === 'published') blogCounts.published = Number(row.n) || 0;
  }

  const whoopState = syncStates.find((s) => s.service === 'whoop');

  return {
    health: {
      whoop: { connected: whoopConnected, state: whoopState ?? null },
      activeJobs: activeJobs.length,
    },
    blog: blogCounts,
    files: Number(fileCount[0]?.n ?? 0),
    gmail: Number(gmailAcctCount[0]?.n ?? 0),
    scraper: Number(scraperCredCount[0]?.n ?? 0),
    tools: {
      total: Number(customToolStats[0]?.total ?? 0),
      enabled: Number(customToolStats[0]?.enabled ?? 0),
    },
    agent: {
      todayCost: Number(todayCost[0]?.cost ?? 0),
      todayActions: Number(todayCost[0]?.count ?? 0),
    },
  };
};
