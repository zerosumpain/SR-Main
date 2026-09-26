import { getWhoopStatus } from '$lib/server/health-service';
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
import { desc, sql, eq } from 'drizzle-orm';
import { spendToday } from '$lib/costs/ledger.server';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {

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
    getWhoopStatus().then((status) => status.connected).catch(() => false),
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
    // One ledger, one midnight. This used to zero the hours on the NODE clock
    // and sum every action_type in the table, so the tile disagreed with
    // /admin/ops/costs on both the window and the rows.
    spendToday().catch(() => ({ costUsd: 0, calls: 0, tokensIn: 0, tokensOut: 0 })),
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
      todayCost: todayCost.costUsd,
      todayActions: todayCost.calls,
    },
  };
};
