/**
 * The owner's alert ledger, pushed.
 *
 * `notification_events` is written by more than one process: `notifyOwner` in
 * this app, and SR-Jkai-Core's copy of it — which is where a chat turn waiting
 * on a plan, a confirmation or a question raises its alert. They share the
 * database, not a process, so the push is driven from the LEDGER: every few
 * seconds this takes the rows routed to the phone that nobody has pushed, and
 * pushes them.
 *
 * Each row is CLAIMED with a conditional update before it is sent, so two
 * processes running this (or a kick racing the timer) push it once. A push
 * Apple accepted for at least one of the owner's phones stamps `nativeAt`,
 * which is what takes it off the app's pull queue — it has been delivered, and
 * raising it again on the next background refresh would be a duplicate. A push
 * that reached no phone (none registered, Apple down) leaves `nativeAt` null,
 * and the pull delivers it as it always did. Pull is the floor; push is faster.
 *
 * Only rows younger than FRESH_MS are taken: a deploy that was down for an
 * hour must not ring the phone with an hour of backlog, which the pull already
 * delivers quietly.
 */

import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { notificationEvents } from '$lib/db/schema';
import { isApnsConfigured, type InterruptionLevel, type PushMessage } from '../apns';
import { pushToOwner, type PushOutcome } from '../push-devices';

const DEFAULT_POLL_MS = 3_000;
const FRESH_MS = 30 * 60_000;
const BATCH = 20;

/** The chat gates a notification can answer, and the app category for each. */
const GATES = new Set(['confirm', 'plan', 'clarify']);

type LedgerRow = Pick<
  typeof notificationEvents.$inferSelect,
  'id' | 'category' | 'title' | 'body' | 'url' | 'severity' | 'data'
>;

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/**
 * The push for one ledger row. PURE.
 *
 * - A chat turn stopped at a gate wears `sr.gate.<gate>` — Approve and Reject
 *   buttons, or a reply field — and carries the ids the app answers it with.
 *   It is TIME-SENSITIVE: the turn is stalled until somebody answers.
 * - A lapsed connection wears `sr.connections` (no buttons; see the app).
 * - Everything else wears `sr.alert`, like the app's own local notifications,
 *   `active` at alert severity and `passive` below it.
 */
export function messageFor(row: LedgerRow): PushMessage {
  const data = (row.data ?? {}) as Record<string, unknown>;
  const gate = str(data.gate);
  const userInfo: Record<string, string> = { id: row.id, category: row.category };
  if (row.url) userInfo.url = row.url;
  const commissionId = data.destination === 'daydream_commission' && data.schemaVersion === 1 ? str(data.commissionId) : undefined;
  if (commissionId) userInfo.commissionId = commissionId;

  if (gate && GATES.has(gate) && str(data.jobId)) {
    for (const key of ['gate', 'jobId', 'planId', 'confirmId', 'clarifyId', 'questionId', 'conversationId']) {
      const v = str(data[key]);
      if (v) userInfo[key] = v;
    }
    return {
      title: row.title,
      body: row.body,
      category: `sr.gate.${gate}`,
      threadId: 'chat',
      level: 'time-sensitive',
      relevance: 1,
      collapseId: row.id,
      userInfo,
      // Nobody can answer a gate the turn has already given up on.
      ttlSeconds: 30 * 60,
    };
  }

  const connections = row.category === 'connections';
  const loud = row.severity === 'alert' || connections;
  const level: InterruptionLevel = loud ? 'active' : 'passive';
  return {
    title: row.title,
    body: row.body,
    category: connections ? 'sr.connections' : 'sr.alert',
    threadId: commissionId ? `commission:${commissionId}` : row.category,
    level,
    relevance: connections ? 1 : loud ? 0.8 : 0.2,
    collapseId: row.id,
    userInfo,
  };
}

export interface DispatchDeps {
  push?: (message: PushMessage) => Promise<PushOutcome>;
  now?: Date;
}

/** One pass: claim, push, stamp. Returns how many rows it pushed. Never throws. */
export async function dispatchPending(deps: DispatchDeps = {}): Promise<number> {
  const push = deps.push ?? ((m: PushMessage) => pushToOwner(m));
  const now = deps.now ?? new Date();
  try {
    const rows = await db
      .select({
        id: notificationEvents.id,
        category: notificationEvents.category,
        title: notificationEvents.title,
        body: notificationEvents.body,
        url: notificationEvents.url,
        severity: notificationEvents.severity,
        data: notificationEvents.data,
      })
      .from(notificationEvents)
      .where(
        and(
          isNull(notificationEvents.nativeAt),
          isNull(notificationEvents.pushedAt),
          gt(notificationEvents.createdAt, new Date(now.getTime() - FRESH_MS)),
        ),
      )
      .orderBy(asc(notificationEvents.createdAt))
      .limit(BATCH);

    let pushed = 0;
    for (const row of rows) {
      const claimed = await db
        .update(notificationEvents)
        .set({ pushedAt: new Date() })
        .where(and(eq(notificationEvents.id, row.id), isNull(notificationEvents.pushedAt)))
        .returning({ id: notificationEvents.id });
      if (!claimed.length) continue;
      const outcome = await push(messageFor(row));
      if (outcome.reached.size > 0) {
        pushed++;
        await db
          .update(notificationEvents)
          .set({ nativeAt: new Date() })
          .where(and(eq(notificationEvents.id, row.id), isNull(notificationEvents.nativeAt)));
      }
    }
    return pushed;
  } catch (error) {
    console.error('[push-dispatch] pass failed:', (error as Error).message);
    return 0;
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
let busy = false;
let again = false;

/** Run a pass now, or straight after the one in flight. */
export function kickPushDispatch(): void {
  if (!isApnsConfigured()) return;
  if (busy) {
    again = true;
    return;
  }
  busy = true;
  void (async () => {
    try {
      do {
        again = false;
        await dispatchPending();
      } while (again);
    } finally {
      busy = false;
    }
  })();
}

export function startPushDispatch(): void {
  if (timer) return;
  if (!isApnsConfigured()) {
    console.log('[push-dispatch] APNS_* is not set — alerts stay pull-only');
    return;
  }
  const raw = parseInt(process.env.NATIVE_PUSH_POLL_MS || '', 10);
  const ms = Number.isFinite(raw) && raw >= 500 ? raw : DEFAULT_POLL_MS;
  console.log(`[push-dispatch] pushing the owner's alerts every ${ms}ms`);
  timer = setInterval(kickPushDispatch, ms);
  timer.unref?.();
}

export function stopPushDispatch(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
