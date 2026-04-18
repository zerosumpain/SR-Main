import { db } from '$lib/db';
import { workflows, workflowNodes, workflowRuns, orchestratorChats, conversations } from '$lib/db/schema';
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

  // WhatsApp chat sessions (now unified in jkai_conversations + orchestrator_chats)
  const whatsappChats = await db.execute(sql`
    SELECT
      c.whatsapp_phone_number AS phone_number,
      COUNT(oc.id) AS message_count,
      MAX(oc.created_at) AS last_message_at,
      (SELECT content FROM orchestrator_chats oc2 WHERE oc2.conversation_id = c.id ORDER BY oc2.created_at DESC LIMIT 1) AS last_message,
      (SELECT role FROM orchestrator_chats oc3 WHERE oc3.conversation_id = c.id ORDER BY oc3.created_at DESC LIMIT 1) AS last_role
    FROM jkai_conversations c
    LEFT JOIN orchestrator_chats oc ON oc.conversation_id = c.id
    WHERE c.source = 'whatsapp'
    GROUP BY c.id, c.whatsapp_phone_number
    ORDER BY MAX(oc.created_at) DESC
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
