import { db } from '$lib/db';
import { conversations, workflowRuns, workflowSchedules, whatsappConversations } from '$lib/db/schema';
import { desc, eq, sql, gte, asc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { getConversationList } from '$lib/jkai/queries';
import { resolveDefaultModel } from '$lib/server/models/settings';

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

  // Check for WhatsApp thread
  const [latestWa] = await db
    .select({ phoneNumber: whatsappConversations.phoneNumber })
    .from(whatsappConversations)
    .orderBy(desc(whatsappConversations.createdAt))
    .limit(1);

  let whatsappThread: { phoneNumber: string; messages: any[] } | null = null;
  if (latestWa) {
    const waMessages = await db
      .select({
        id: whatsappConversations.id,
        role: whatsappConversations.role,
        content: whatsappConversations.content,
        createdAt: whatsappConversations.createdAt,
      })
      .from(whatsappConversations)
      .where(eq(whatsappConversations.phoneNumber, latestWa.phoneNumber))
      .orderBy(asc(whatsappConversations.createdAt));

    whatsappThread = { phoneNumber: latestWa.phoneNumber, messages: waMessages };
  }

  return {
    conversations: convList,
    metrics,
    whatsappThread,
    defaultChatModel: await resolveDefaultModel('chat'),
  };
};
