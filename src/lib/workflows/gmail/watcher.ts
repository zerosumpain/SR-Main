import { db } from '$lib/db';
import { gmailAccounts, gmailWatches, gmailHistoryCursors, type GmailAccount } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { gmailService } from './service';
import { eventBus } from '$lib/workflows/event-bus';

const POLL_INTERVAL_MS = 45_000;

export async function pollAccountOnce(account: GmailAccount): Promise<void> {
  const cursorRows = await db.select().from(gmailHistoryCursors).where(eq(gmailHistoryCursors.accountId, account.id));
  const cursor = cursorRows[0];

  if (!cursor) {
    // First poll: seed cursor to current historyId so we don't flood on initial connect.
    const historyId = await gmailService.getLatestHistoryId(account);
    await db.insert(gmailHistoryCursors).values({ accountId: account.id, historyId, updatedAt: new Date() })
      .onConflictDoUpdate({ target: gmailHistoryCursors.accountId, set: { historyId, updatedAt: new Date() } });
    return;
  }

  const watches = await db.select().from(gmailWatches).where(
    and(eq(gmailWatches.accountId, account.id), eq(gmailWatches.enabled, true)),
  );
  if (watches.length === 0) return;

  const { addedMessageIds, newHistoryId } = await gmailService.historyListSince(account, cursor.historyId);

  for (const messageId of addedMessageIds) {
    for (const watch of watches) {
      // Match via a scoped list query: the watch's query AND the specific message id.
      const matches = await gmailService.listMessages(account, `${watch.query} rfc822msgid:${messageId}`, 1);
      if (matches.length === 0) {
        const broader = await gmailService.listMessages(account, watch.query, 100);
        if (!broader.includes(messageId)) continue;
      }

      const msg = await gmailService.fetchMessage(account, messageId);
      eventBus.emit({
        type: 'gmail.message.received',
        accountId: account.id,
        accountEmail: account.email,
        watchId: watch.id,
        watchLabel: watch.label,
        messageId: msg.id,
        threadId: msg.threadId,
        from: msg.headers.from,
        to: msg.headers.to,
        subject: msg.headers.subject,
        snippet: msg.snippet,
        labels: msg.labelIds,
        timestamp: new Date().toISOString(),
      });
      break; // one emit per message, even if multiple watches match
    }
  }

  if (newHistoryId !== cursor.historyId) {
    await db.update(gmailHistoryCursors)
      .set({ historyId: newHistoryId, updatedAt: new Date() })
      .where(eq(gmailHistoryCursors.accountId, account.id));
  }
}

let timer: NodeJS.Timeout | null = null;
let stopping = false;

export function startWatcher(): void {
  if (timer) return;
  stopping = false;
  const loop = async () => {
    if (stopping) return;
    try {
      const accounts = await db.select().from(gmailAccounts).where(eq(gmailAccounts.status, 'active'));
      for (const acct of accounts) {
        try {
          await pollAccountOnce(acct);
        } catch (err: any) {
          console.error(`[gmail.watcher] account=${acct.email} error=${err?.message}`);
          if (/auth_expired|invalid_grant/i.test(String(err?.message))) {
            eventBus.emit({
              type: 'gmail.auth.expired',
              accountId: acct.id,
              accountEmail: acct.email,
              error: String(err?.message).slice(0, 300),
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    } finally {
      if (!stopping) timer = setTimeout(loop, POLL_INTERVAL_MS);
    }
  };
  timer = setTimeout(loop, 1000);
}

export function stopWatcher(): void {
  stopping = true;
  if (timer) { clearTimeout(timer); timer = null; }
}
