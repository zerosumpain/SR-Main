// src/lib/workflows/chat/followup-queue.ts
// In-memory follow-up queue with interval-based worker.
// Inspired by OpenClaw's heartbeat system events — no cron, just setInterval + event queue.

import { db } from '$lib/db';
import { orchestratorChats, conversations } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { generalChat } from './general-chat';

export interface FollowUpCheck {
  done: boolean;
  result?: unknown;
  summary?: string; // human-readable status for "still running" updates
}

export interface FollowUp {
  id: string;
  conversationId: string;
  taskType: string;
  taskId: string;
  checkFn: () => Promise<FollowUpCheck>;
  completionPrompt: string; // injected as context when the task completes
  notifyWhatsApp: boolean;
  whatsAppNumber?: string;
  dueAt: number;
  retries: number;
  maxRetries: number;
  intervalMs: number; // base re-check interval (with backoff)
  createdAt: number;
}

// --- SSE subscriber registry ---
type SSECallback = (conversationId: string, message: { role: string; content: string; source: string }) => void;
const sseSubscribers = new Map<string, Set<SSECallback>>();

export function subscribeToConversation(conversationId: string, cb: SSECallback): () => void {
  if (!sseSubscribers.has(conversationId)) {
    sseSubscribers.set(conversationId, new Set());
  }
  sseSubscribers.get(conversationId)!.add(cb);
  return () => {
    sseSubscribers.get(conversationId)?.delete(cb);
    if (sseSubscribers.get(conversationId)?.size === 0) {
      sseSubscribers.delete(conversationId);
    }
  };
}

export function notifySubscribers(conversationId: string, message: { role: string; content: string; source: string }) {
  const subs = sseSubscribers.get(conversationId);
  if (subs) {
    for (const cb of subs) {
      try { cb(conversationId, message); } catch {}
    }
  }
}

// --- Follow-up queue ---
const queue: FollowUp[] = [];
let workerTimer: ReturnType<typeof setInterval> | null = null;

const WORKER_INTERVAL_MS = 15_000; // check every 15 seconds
const DEFAULT_CHECK_INTERVAL_MS = 30_000; // 30s between re-checks
const DEFAULT_MAX_RETRIES = 40; // ~20 min with backoff
const BACKOFF_MULTIPLIER = 1.2;

export function enqueueFollowUp(opts: {
  conversationId: string;
  taskType: string;
  taskId: string;
  checkFn: () => Promise<FollowUpCheck>;
  completionPrompt: string;
  notifyWhatsApp?: boolean;
  whatsAppNumber?: string;
  delayMs?: number;
  intervalMs?: number;
  maxRetries?: number;
}): string {
  const id = crypto.randomUUID();
  const now = Date.now();
  queue.push({
    id,
    conversationId: opts.conversationId,
    taskType: opts.taskType,
    taskId: opts.taskId,
    checkFn: opts.checkFn,
    completionPrompt: opts.completionPrompt,
    notifyWhatsApp: opts.notifyWhatsApp ?? false,
    whatsAppNumber: opts.whatsAppNumber,
    dueAt: now + (opts.delayMs ?? DEFAULT_CHECK_INTERVAL_MS),
    retries: 0,
    maxRetries: opts.maxRetries ?? DEFAULT_MAX_RETRIES,
    intervalMs: opts.intervalMs ?? DEFAULT_CHECK_INTERVAL_MS,
    createdAt: now,
  });
  console.log(`[followup] Enqueued: ${opts.taskType}/${opts.taskId} for conversation ${opts.conversationId} (check in ${(opts.delayMs ?? DEFAULT_CHECK_INTERVAL_MS) / 1000}s)`);
  ensureWorkerRunning();
  return id;
}

export function cancelFollowUp(id: string): boolean {
  const idx = queue.findIndex(f => f.id === id);
  if (idx >= 0) {
    const removed = queue.splice(idx, 1)[0];
    console.log(`[followup] Cancelled: ${removed.taskType}/${removed.taskId}`);
    return true;
  }
  return false;
}

export function getQueueStatus(): Array<{ id: string; taskType: string; taskId: string; conversationId: string; retries: number; dueAt: number }> {
  return queue.map(f => ({
    id: f.id,
    taskType: f.taskType,
    taskId: f.taskId,
    conversationId: f.conversationId,
    retries: f.retries,
    dueAt: f.dueAt,
  }));
}

function ensureWorkerRunning() {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    processQueue().catch(err => {
      console.error('[followup] Worker error:', err instanceof Error ? err.message : err);
    });
  }, WORKER_INTERVAL_MS);
  console.log(`[followup] Worker started (${WORKER_INTERVAL_MS / 1000}s interval)`);
}

async function processQueue() {
  if (queue.length === 0) return;
  const now = Date.now();
  const due = queue.filter(f => f.dueAt <= now);
  const nextDue = queue.length > 0 ? Math.min(...queue.map(f => f.dueAt)) : 0;
  const waitSec = nextDue ? Math.round((nextDue - now) / 1000) : 0;
  if (due.length > 0) {
    console.log(`[followup] Processing ${due.length} due item(s) (${queue.length} total in queue)`);
  } else if (queue.length > 0) {
    console.log(`[followup] Tick: ${queue.length} item(s) waiting, next due in ${waitSec}s`);
  }

  for (const item of due) {
    try {
      console.log(`[followup] Checking: ${item.taskType}/${item.taskId} (retry ${item.retries})`);
      const check = await item.checkFn();
      console.log(`[followup] Check result: done=${check.done} summary=${check.summary?.slice(0, 80)}`);

      if (check.done) {
        // Task completed — remove from queue and deliver
        const idx = queue.indexOf(item);
        if (idx >= 0) queue.splice(idx, 1);
        console.log(`[followup] Task done: ${item.taskType}/${item.taskId} — delivering to ${item.conversationId}`);
        await deliverFollowUp(item, check);
      } else {
        // Not done — re-queue with backoff
        item.retries++;
        if (item.retries >= item.maxRetries) {
          const idx = queue.indexOf(item);
          if (idx >= 0) queue.splice(idx, 1);
          console.log(`[followup] Max retries reached for ${item.taskType}/${item.taskId} — giving up`);
          await deliverTimeout(item);
        } else {
          const backoff = Math.min(item.intervalMs * Math.pow(BACKOFF_MULTIPLIER, item.retries), 300_000); // cap at 5 min
          item.dueAt = now + backoff;
        }
      }
    } catch (err) {
      console.error(`[followup] Error checking ${item.taskType}/${item.taskId}:`, err instanceof Error ? err.message : err);
      item.retries++;
      if (item.retries >= item.maxRetries) {
        const idx = queue.indexOf(item);
        if (idx >= 0) queue.splice(idx, 1);
      } else {
        item.dueAt = now + item.intervalMs;
      }
    }
  }

  // Stop worker if queue is empty
  if (queue.length === 0 && workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
    console.log('[followup] Queue empty — worker stopped');
  }
}

async function deliverFollowUp(item: FollowUp, check: FollowUpCheck) {
  try {
    // Load conversation history for context
    const history = await db
      .select({ role: orchestratorChats.role, content: orchestratorChats.content })
      .from(orchestratorChats)
      .where(eq(orchestratorChats.conversationId, item.conversationId))
      .orderBy(orchestratorChats.createdAt);

    const recentHistory = history.slice(-10).map(h => ({ role: h.role, content: h.content }));

    // Build a follow-up prompt with the completion context
    const resultContext = check.summary || JSON.stringify(check.result ?? {});
    const followUpMessage = `[SYSTEM FOLLOW-UP] A background task has completed.\n\nTask: ${item.taskType} (ID: ${item.taskId})\nResult:\n${resultContext}\n\n${item.completionPrompt}`;

    const { response } = await generalChat(followUpMessage, recentHistory, {});

    // Save to DB
    await db.insert(orchestratorChats).values({ conversationId: item.conversationId, role: 'assistant', content: response });
    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, item.conversationId));

    // Push via SSE to web UI
    notifySubscribers(item.conversationId, { role: 'assistant', content: response, source: 'followup' });

    // WhatsApp notification if requested
    if (item.notifyWhatsApp && item.whatsAppNumber) {
      try {
        const { getWhatsAppService } = await import('$lib/workflows/whatsapp/service');
        const wa = getWhatsAppService();
        await wa.sendMessage(item.whatsAppNumber, response);
        console.log(`[followup] WhatsApp notification sent to ${item.whatsAppNumber}`);
      } catch (waErr) {
        console.error(`[followup] WhatsApp send failed:`, waErr instanceof Error ? waErr.message : waErr);
      }
    }

    console.log(`[followup] Delivered: ${item.taskType}/${item.taskId}`);
  } catch (err) {
    console.error(`[followup] Delivery failed for ${item.taskType}/${item.taskId}:`, err instanceof Error ? err.message : err);
  }
}

async function deliverTimeout(item: FollowUp) {
  const message = `I was tracking a ${item.taskType} task (${item.taskId}) but it hasn't completed after ${Math.round((Date.now() - item.createdAt) / 60000)} minutes. You may want to check on it manually.`;

  try {
    await db.insert(orchestratorChats).values({ conversationId: item.conversationId, role: 'assistant', content: message });
    await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, item.conversationId));
    notifySubscribers(item.conversationId, { role: 'assistant', content: message, source: 'followup' });
  } catch (err) {
    console.error(`[followup] Timeout delivery failed:`, err instanceof Error ? err.message : err);
  }
}
