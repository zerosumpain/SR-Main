import { db } from '$lib/db';
import { workflows, workflowNodes, orchestratorChats, conversations } from '$lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { emit as emitPlatformEvent } from '$lib/events/platform-bus';
import type { GmailMessageReceivedEvent, GmailAuthExpiredEvent } from '$lib/workflows/types';
import { notifySubscribers } from '$lib/workflows/chat/followup-queue';
import { gmailEventBus } from './watcher';
import { startTriggeredRun } from '$lib/workflows/start-run';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Push a plain system message into the most recently active web conversation
 * and fan it out over the SSE stream so the live /jkai chat UI receives it.
 * If no active conversation exists the notification is silently dropped.
 */
/**
 * The thread a Gmail notification lands in: the owner's most recently active
 * web thread. Never a member's — their thread is theirs, and the owner's mail
 * has no business in it.
 */
export async function gmailNotificationTarget(): Promise<string | null> {
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.source, 'web'), eq(conversations.principalId, 'owner')))
    .orderBy(desc(conversations.updatedAt))
    .limit(1);
  return conv?.id ?? null;
}

async function pushChatNotification(content: string): Promise<void> {
  try {
    const convId = await gmailNotificationTarget();
    if (!convId) return;
    const conv = { id: convId };

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

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleMessageReceived(event: GmailMessageReceivedEvent): Promise<void> {
  const { accountId, accountEmail, watchId, watchLabel, from, subject, snippet } = event;

  console.log(`[gmail-bridge] gmail.message.received account=${accountEmail} watch=${watchLabel} subject="${subject}"`);

  const gmail = {
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
  };
  // Every watched message is a `gmail.inbound` event; gmail-trigger nodes below
  // are the older, account-scoped form of the same thing.
  emitPlatformEvent('gmail.inbound', gmail, { source: 'gmail-bridge' });

  // 1. Find matching workflows and dispatch each one.
  const matched = await findMatchingWorkflows(accountId, watchId);
  for (const { workflowId, workflowName } of matched) {
    console.log(`[gmail-bridge] dispatching workflow "${workflowName}" (${workflowId})`);
    await startTriggeredRun(workflowId, { gmail }, { label: 'gmail-bridge' });
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
