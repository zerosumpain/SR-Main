import { db } from '$lib/db';
import {
  workflows,
  workflowNodes,
  workflowEdges,
  workflowRuns,
  orchestratorChats,
  conversations,
} from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import type { WorkflowDefinition } from '$lib/workflows/types';
import type { GmailMessageReceivedEvent, GmailAuthExpiredEvent } from '$lib/workflows/types';
import { notifySubscribers } from '$lib/workflows/chat/followup-queue';
import { gmailEventBus } from './watcher';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Push a plain system message into the most recently active web conversation
 * and fan it out over the SSE stream so the live /jkai chat UI receives it.
 * If no active conversation exists the notification is silently dropped.
 */
async function pushChatNotification(content: string): Promise<void> {
  try {
    const [conv] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.source, 'web'))
      .orderBy(desc(conversations.updatedAt))
      .limit(1);

    if (!conv) return;

    await db.insert(orchestratorChats).values({
      conversationId: conv.id,
      role: 'assistant',
      content,
      metadata: { source: 'gmail_bridge' },
    });

    notifySubscribers(conv.id, { role: 'assistant', content, source: 'gmail_bridge' });
  } catch (err) {
    console.error('[gmail-bridge] pushChatNotification failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Find all enabled workflows whose first node is a `gmail-trigger` matching
 * the given accountId (and optionally watchId when the trigger node config
 * specifies one). Returns zero rows gracefully until Task 14 registers the
 * node type.
 */
async function findMatchingWorkflows(
  accountId: number,
  watchId: number,
): Promise<Array<{ workflowId: string; workflowName: string }>> {
  // Load all nodes of type 'gmail-trigger' in one query.
  const triggerNodes = await db
    .select({
      id: workflowNodes.id,
      workflowId: workflowNodes.workflowId,
      config: workflowNodes.config,
    })
    .from(workflowNodes)
    .where(eq(workflowNodes.type, 'gmail-trigger'));

  if (triggerNodes.length === 0) return [];

  const matched: Array<{ workflowId: string; workflowName: string }> = [];

  for (const node of triggerNodes) {
    const config = (node.config ?? {}) as Record<string, unknown>;

    // The trigger must reference this Gmail account.
    if (config.accountId !== undefined && Number(config.accountId) !== accountId) continue;

    // If the trigger pins a specific watch, it must match.
    if (config.watchId !== undefined && Number(config.watchId) !== watchId) continue;

    // Verify the parent workflow exists.
    const [wf] = await db
      .select({ id: workflows.id, name: workflows.name })
      .from(workflows)
      .where(eq(workflows.id, node.workflowId))
      .limit(1);

    if (!wf) continue;

    matched.push({ workflowId: wf.id, workflowName: wf.name });
  }

  return matched;
}

/**
 * Build a WorkflowDefinition from the DB and fire it via the engine,
 * persisting run status on completion.
 */
async function dispatchWorkflow(
  workflowId: string,
  initialInput: Record<string, unknown>,
): Promise<void> {
  const [wf] = await db
    .select({ id: workflows.id, name: workflows.name })
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .limit(1);
  if (!wf) return;

  const nodes = await db
    .select()
    .from(workflowNodes)
    .where(eq(workflowNodes.workflowId, workflowId));

  const edges = await db
    .select()
    .from(workflowEdges)
    .where(eq(workflowEdges.workflowId, workflowId));

  const definition: WorkflowDefinition = {
    id: wf.id,
    name: wf.name,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      config: (n.config as Record<string, unknown>) ?? {},
      label: n.label,
      position: (n.position as { x: number; y: number }) ?? { x: 0, y: 0 },
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
    })),
  };

  const runId = crypto.randomUUID();

  // #19 DISPATCH SWITCH (ADDITIVE, FEATURE-FLAGGED): in worker mode the run is
  // created 'pending' with its event payload persisted to input_data, then
  // enqueued for the out-of-process worker to claim + execute (the worker
  // replays input_data into engine.execute, so the gmail-trigger downstream
  // sees the same payload). When the flag is OFF this is the original
  // in-process 'running' insert + engine.execute below, byte-for-byte.
  const workerMode = process.env.JKAI_RUN_WORKER === '1';

  await db.insert(workflowRuns).values({
    id: runId,
    workflowId,
    status: workerMode ? 'pending' : 'running',
    trigger: 'event',
    startedAt: new Date(),
    inputData: initialInput,
  });

  if (workerMode) {
    const { enqueue } = await import('$lib/workflows/run-queue');
    await enqueue(runId);
    return;
  }

  engine
    .execute(definition, runId, initialInput, undefined, workflowId)
    .then(async (result) => {
      await db
        .update(workflowRuns)
        .set({ status: result.status, completedAt: new Date(), error: result.error ?? null })
        .where(eq(workflowRuns.id, runId));
    })
    .catch(async (err) => {
      console.error(`[gmail-bridge] workflow execution error (runId=${runId}):`, err instanceof Error ? err.message : err);
      try {
        await db
          .update(workflowRuns)
          .set({ status: 'failed', completedAt: new Date(), error: err instanceof Error ? err.message : String(err) })
          .where(eq(workflowRuns.id, runId));
      } catch {
        /* swallow */
      }
    });
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleMessageReceived(event: GmailMessageReceivedEvent): Promise<void> {
  const { accountId, accountEmail, watchId, watchLabel, from, subject, snippet } = event;

  console.log(`[gmail-bridge] gmail.message.received account=${accountEmail} watch=${watchLabel} subject="${subject}"`);

  // 1. Find matching workflows and dispatch each one.
  const matched = await findMatchingWorkflows(accountId, watchId);

  for (const { workflowId, workflowName } of matched) {
    console.log(`[gmail-bridge] dispatching workflow "${workflowName}" (${workflowId})`);
    await dispatchWorkflow(workflowId, {
      gmail: {
        accountId: event.accountId,
        accountEmail: event.accountEmail,
        watchId: event.watchId,
        watchLabel: event.watchLabel,
        messageId: event.messageId,
        threadId: event.threadId,
        from: event.from,
        to: event.to,
        subject: event.subject,
        snippet: event.snippet,
        labels: event.labels,
        timestamp: event.timestamp,
      },
    });
  }

  // 2. Push a compact preview into /jkai chat.
  const preview = `**Gmail** — ${accountEmail} (${watchLabel})\nFrom: ${from}\nSubject: ${subject}\n${snippet ? `> ${snippet.slice(0, 120)}` : ''}${matched.length > 0 ? `\n\n_Dispatched ${matched.length} workflow(s)._` : ''}`.trimEnd();

  await pushChatNotification(preview);
}

async function handleAuthExpired(event: GmailAuthExpiredEvent): Promise<void> {
  const { accountEmail, error } = event;

  console.warn(`[gmail-bridge] gmail.auth.expired account=${accountEmail} error=${error}`);

  const message = `**Gmail auth expired** — account \`${accountEmail}\` requires re-authentication.\nError: ${error.slice(0, 200)}`;
  await pushChatNotification(message);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

let messageHandler: ((event: GmailMessageReceivedEvent) => void) | null = null;
let authExpiredHandler: ((event: GmailAuthExpiredEvent) => void) | null = null;

export function registerGmailBridge(): void {
  if (messageHandler) return; // already registered

  messageHandler = (event: GmailMessageReceivedEvent) => {
    handleMessageReceived(event).catch((err) => {
      console.error('[gmail-bridge] handleMessageReceived threw:', err instanceof Error ? err.message : err);
    });
  };

  authExpiredHandler = (event: GmailAuthExpiredEvent) => {
    handleAuthExpired(event).catch((err) => {
      console.error('[gmail-bridge] handleAuthExpired threw:', err instanceof Error ? err.message : err);
    });
  };

  gmailEventBus.on('gmail.message.received', messageHandler);
  gmailEventBus.on('gmail.auth.expired', authExpiredHandler);

  console.log('[gmail-bridge] registered');
}

export function unregisterGmailBridge(): void {
  if (messageHandler) {
    gmailEventBus.off('gmail.message.received', messageHandler);
    messageHandler = null;
  }
  if (authExpiredHandler) {
    gmailEventBus.off('gmail.auth.expired', authExpiredHandler);
    authExpiredHandler = null;
  }
  console.log('[gmail-bridge] unregistered');
}
