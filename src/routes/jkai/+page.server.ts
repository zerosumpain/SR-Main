import { db } from '$lib/db';
import { conversations, jkaiBuilds, workflowRuns, workflowSchedules, orchestratorChats } from '$lib/db/schema';
import { desc, eq, sql, gte, asc } from 'drizzle-orm';
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

  // LLM spend over the last 24h — windowed to match the run metrics above.
  // conversations.cost_usd / jkaiBuilds.cost_usd are running totals, so this
  // sums the full cost of conversations + builds *touched* in the window
  // (a per-turn cost ledger would be needed for an exact 24h slice).
  const [convCostRow] = await db
    .select({ convCost: sql<string>`COALESCE(SUM(cost_usd), 0)::text` })
    .from(conversations)
    .where(gte(conversations.updatedAt, since));
  const [buildCostRow] = await db
    .select({ buildCost: sql<string>`COALESCE(SUM(cost_usd), 0)::text` })
    .from(jkaiBuilds)
    .where(gte(jkaiBuilds.updatedAt, since));
  const totalSpendUsd = Number(convCostRow?.convCost ?? 0) + Number(buildCostRow?.buildCost ?? 0);

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
    totalSpendUsd,
    approvalUi,
  };
};
