import { db } from '$lib/db';
import { conversations, jkaiBuilds, workflowRuns, workflowSchedules, orchestratorChats } from '$lib/db/schema';
import { desc, eq, sql, gte, asc } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { PageServerLoad } from './$types';
import { getConversationList } from '$lib/jkai/queries';
import { resolveDefaultModel, resolveChatAltOpenRouterModel, getApprovalUiSettings } from '$lib/server/models/settings';

export const load: PageServerLoad = async () => {
  // Load conversations with preview
  const convList = await getConversationList();

  // Load metrics (last 24h)
  const since = new Date(Date.now() - 86400000);
  const runCounts = await db
    .select({
      status: workflowRuns.status,
      count: sql<number>`count(*)::int`,
    })
    .from(workflowRuns)
    .where(gte(workflowRuns.startedAt, since))
    .groupBy(workflowRuns.status);

  const [scheduleCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workflowSchedules)
    .where(eq(workflowSchedules.enabled, true));

  const metrics = {
    scheduled: scheduleCount?.count ?? 0,
    running: 0,
    completed: 0,
    failed: 0,
  };
  for (const row of runCounts) {
    if (row.status in metrics) {
      metrics[row.status as keyof typeof metrics] = row.count;
    }
  }

  // Check for WhatsApp thread (now unified in jkai_conversations + orchestrator_chats)
  const [latestWaConv] = await db
    .select({ id: conversations.id, phoneNumber: conversations.whatsappPhoneNumber })
    .from(conversations)
    .where(eq(conversations.source, 'whatsapp'))
    .orderBy(desc(conversations.updatedAt))
    .limit(1);

  let whatsappThread: { phoneNumber: string; messages: any[] } | null = null;
  if (latestWaConv?.phoneNumber) {
    const waMessages = await db
      .select({
        id: orchestratorChats.id,
        role: orchestratorChats.role,
        content: orchestratorChats.content,
        createdAt: orchestratorChats.createdAt,
      })
      .from(orchestratorChats)
      .where(eq(orchestratorChats.conversationId, latestWaConv.id))
      .orderBy(asc(orchestratorChats.createdAt));

    whatsappThread = { phoneNumber: latestWaConv.phoneNumber, messages: waMessages };
  }

  // LLM spend per window (day / week / month / lifetime) — the top-bar metric
  // is click-to-cycle, so all four are computed up front. conversations.cost_usd
  // / jkaiBuilds.cost_usd are running totals, so each window sums the full cost
  // of rows *touched* in it (a per-turn ledger would be needed for an exact
  // slice). `lifetime` is unfiltered and therefore exact.
  const weekCut = new Date(Date.now() - 7 * 86400000);
  const monthCut = new Date(Date.now() - 30 * 86400000);
  const spendCols = (col: AnyPgColumn) => ({
    day: sql<string>`COALESCE(SUM(cost_usd) FILTER (WHERE ${col} >= ${since}), 0)::text`,
    week: sql<string>`COALESCE(SUM(cost_usd) FILTER (WHERE ${col} >= ${weekCut}), 0)::text`,
    month: sql<string>`COALESCE(SUM(cost_usd) FILTER (WHERE ${col} >= ${monthCut}), 0)::text`,
    lifetime: sql<string>`COALESCE(SUM(cost_usd), 0)::text`,
  });
  const [convSpend] = await db.select(spendCols(conversations.updatedAt)).from(conversations);
  const [buildSpend] = await db.select(spendCols(jkaiBuilds.updatedAt)).from(jkaiBuilds);
  const spendByPeriod = {
    day: Number(convSpend?.day ?? 0) + Number(buildSpend?.day ?? 0),
    week: Number(convSpend?.week ?? 0) + Number(buildSpend?.week ?? 0),
    month: Number(convSpend?.month ?? 0) + Number(buildSpend?.month ?? 0),
    lifetime: Number(convSpend?.lifetime ?? 0) + Number(buildSpend?.lifetime ?? 0),
  };

  const [defaultChatModel, chatAltOpenRouterModel, approvalUi] = await Promise.all([
    resolveDefaultModel('chat'),
    resolveChatAltOpenRouterModel(),
    getApprovalUiSettings(),
  ]);

  return {
    conversations: convList,
    metrics,
    whatsappThread,
    defaultChatModel,
    chatAltOpenRouterModel,
    spendByPeriod,
    approvalUi,
  };
};
