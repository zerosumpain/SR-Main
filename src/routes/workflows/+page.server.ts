import { db } from '$lib/db';
import { workflows, workflowNodes, workflowRuns, orchestratorChats, whatsappConversations } from '$lib/db/schema';
import { desc, eq, count, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const rows = await db.select().from(workflows).orderBy(desc(workflows.createdAt));

  // Enrich with node count and last run
  const enriched = await Promise.all(rows.map(async (w) => {
    const [nodeCount] = await db
      .select({ count: count() })
      .from(workflowNodes)
      .where(eq(workflowNodes.workflowId, w.id));

    const [lastRun] = await db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, w.id))
      .orderBy(desc(workflowRuns.startedAt))
      .limit(1);

    return {
      ...w,
      nodeCount: nodeCount?.count ?? 0,
      lastRun: lastRun ? { status: lastRun.status, startedAt: lastRun.startedAt } : null,
      triggerType: (w.trigger as any)?.type || 'manual',
    };
  }));

  // Web chat sessions (orchestrator chats grouped by workflowId)
  const webChats = await db.execute(sql`
    SELECT
      workflow_id,
      w.name as workflow_name,
      COUNT(*) as message_count,
      MAX(oc.created_at) as last_message_at,
      (SELECT content FROM orchestrator_chats WHERE workflow_id = oc.workflow_id ORDER BY created_at DESC LIMIT 1) as last_message
    FROM orchestrator_chats oc
    LEFT JOIN workflows w ON w.id = oc.workflow_id
    WHERE oc.workflow_id IS NOT NULL
    GROUP BY workflow_id, w.name
    ORDER BY MAX(oc.created_at) DESC
    LIMIT 20
  `);

  // WhatsApp chat sessions (grouped by phone number)
  const whatsappChats = await db.execute(sql`
    SELECT
      phone_number,
      COUNT(*) as message_count,
      MAX(created_at) as last_message_at,
      (SELECT content FROM whatsapp_conversations wc2 WHERE wc2.phone_number = wc.phone_number ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT role FROM whatsapp_conversations wc3 WHERE wc3.phone_number = wc.phone_number ORDER BY created_at DESC LIMIT 1) as last_role
    FROM whatsapp_conversations wc
    GROUP BY phone_number
    ORDER BY MAX(created_at) DESC
    LIMIT 20
  `);

  return {
    workflows: enriched,
    chatSessions: {
      web: webChats.rows,
      whatsapp: whatsappChats.rows,
    },
  };
};
