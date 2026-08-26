// src/lib/daydream/deliver.ts
//
// Deciding whether to interrupt, and refusing most of the time.
//
// Push is the default channel by the owner's choice (2026-08-26), which moves
// all of the risk here. With silent-default a bad detector is a bad row on a
// page nobody opens; with push-forward it is a buzz in a pocket, and the thing
// that gets muted is the whole feature rather than one kind.
//
// So the limits in this file are not administrative trim — they are what makes
// push-forward survivable. Nothing above raises them: the budget in budget.ts
// governs how much THINKING happens, and having quota left over is never a
// reason to interrupt anybody.

import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts } from '$lib/db/schema';
import { LOCAL_TZ } from './types';

/** At most one interrupting notification in this many hours. */
export const MIN_GAP_HOURS = 3;
/** And at most this many in a local day. */
export const MAX_PER_DAY = 4;
/** The same kind may not interrupt twice inside this window. */
export const PER_KIND_COOLDOWN_HOURS = 20;
/** Nothing buzzes outside these local hours, whatever it scored. */
export const QUIET_HOURS = { start: 8, end: 21 };

export type Channel = 'push' | 'chat' | 'silent';

export interface DeliveryDecision {
  channel: Channel;
  /** Set when the channel was downgraded to silent, for the ledger. */
  suppressedReason: string | null;
}

function localHour(now: Date, tz = LOCAL_TZ): number {
  const hh = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(now);
  return Number(hh) % 24;
}

function localDayStart(now: Date, tz = LOCAL_TZ): Date {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const num = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return new Date(now.getTime() - ((num('hour') % 24) * 3600 + num('minute') * 60 + num('second')) * 1000);
}

export interface RateState {
  /** Interrupting deliveries so far in the local day. */
  todayCount: number;
  /** When the last interrupting delivery went out. */
  lastDeliveredAt: Date | null;
  /** Last interrupting delivery per kind. */
  lastByKind: Map<string, Date>;
}

export async function readRateState(now: Date): Promise<RateState> {
  const dayStart = localDayStart(now);
  const since = new Date(Math.min(dayStart.getTime(), now.getTime() - PER_KIND_COOLDOWN_HOURS * 3_600_000));

  const rows = await db
    .select({
      kind: daydreamThoughts.kind,
      channel: daydreamThoughts.channel,
      deliveredAt: daydreamThoughts.deliveredAt,
    })
    .from(daydreamThoughts)
    .where(and(isNotNull(daydreamThoughts.deliveredAt), gte(daydreamThoughts.deliveredAt, since)))
    .orderBy(desc(daydreamThoughts.deliveredAt));

  // Only INTERRUPTING channels count against the limits. A thought that quietly
  // landed on the page has cost the owner nothing and must not use up the day's
  // allowance — otherwise the ledger filling itself in would silence the
  // notifications, which is precisely backwards.
  const interrupting = rows.filter((r) => r.channel === 'push' || r.channel === 'chat');

  const lastByKind = new Map<string, Date>();
  for (const r of interrupting) {
    if (r.deliveredAt && !lastByKind.has(r.kind)) lastByKind.set(r.kind, r.deliveredAt);
  }

  return {
    todayCount: interrupting.filter((r) => r.deliveredAt && r.deliveredAt >= dayStart).length,
    lastDeliveredAt: interrupting[0]?.deliveredAt ?? null,
    lastByKind,
  };
}

/**
 * Which channel, if any, this thought has earned. PURE, so every limit is
 * testable without a database or a clock.
 *
 * A refusal is never a discard: the caller writes the thought with
 * `channel: 'silent'` and the reason, and it appears on the ledger page under
 * "held back". Nothing noticed is ever lost, it just does not buzz.
 */
export function chooseChannel(
  thought: { kind: string; score: number },
  state: RateState,
  opts: { now: Date; threshold: number; hasPushSubscriber: boolean },
): DeliveryDecision {
  const { now, threshold } = opts;

  if (thought.score < threshold) {
    return { channel: 'silent', suppressedReason: `below_threshold (${thought.score} < ${threshold})` };
  }

  const hour = localHour(now);
  if (hour < QUIET_HOURS.start || hour >= QUIET_HOURS.end) {
    return { channel: 'silent', suppressedReason: 'quiet_hours' };
  }

  const lastKind = state.lastByKind.get(thought.kind);
  if (lastKind && now.getTime() - lastKind.getTime() < PER_KIND_COOLDOWN_HOURS * 3_600_000) {
    return { channel: 'silent', suppressedReason: 'kind_cooldown' };
  }

  if (state.todayCount >= MAX_PER_DAY) {
    return { channel: 'silent', suppressedReason: 'daily_cap' };
  }

  if (
    state.lastDeliveredAt &&
    now.getTime() - state.lastDeliveredAt.getTime() < MIN_GAP_HOURS * 3_600_000
  ) {
    return { channel: 'silent', suppressedReason: 'min_gap' };
  }

  if (!opts.hasPushSubscriber) {
    // Nowhere to push. Chat still reaches a desk, and is not a downgrade the
    // owner needs telling about.
    return { channel: 'chat', suppressedReason: null };
  }

  return { channel: 'push', suppressedReason: null };
}

/** Send it, and record what happened. One channel per thought, never two. */
export async function deliver(
  thought: { id: string; kind: string; title: string; narrative: string | null; explanation: string },
  decision: DeliveryDecision,
  now: Date,
): Promise<{ sent: boolean; error: string | null }> {
  const body = thought.narrative ?? thought.explanation;
  let sent = false;
  let error: string | null = null;

  if (decision.channel === 'push') {
    try {
      const { notifyAllSubscribers } = await import('$lib/server/push');
      await notifyAllSubscribers({
        title: thought.title,
        body: body.slice(0, 240),
        url: '/jkai/daydreams',
        data: { thoughtId: thought.id, kind: thought.kind },
        // Top level, not inside `data` — the service worker parses the whole
        // body as one object and reads these from it directly.
        //
        // `never_kind` is on the notification rather than buried on the page on
        // purpose: with push as the default channel it is the escape hatch, and
        // an escape hatch that needs a page load is not one. Most platforms
        // render only the first two, so this is priority order.
        actions: [
          { action: 'not_useful', title: 'Not useful' },
          { action: 'never_kind', title: 'Never this' },
          { action: 'useful', title: 'Useful' },
        ],
        actionEndpoint: '/api/daydream/feedback',
        actionPayload: { id: thought.id },
      });
      sent = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  } else if (decision.channel === 'chat') {
    try {
      const conversationId = await latestConversationId();
      if (!conversationId) {
        // No conversation to drop a note into. Not an error — it just means the
        // chat channel does not exist yet, so the thought stays on the page.
        error = 'no conversation to post into';
      } else {
        const { postHeartbeatNote } = await import('$lib/heartbeat/llm');
        await postHeartbeatNote({
          conversationId,
          text: `**${thought.title}**\n\n${body}`,
          activityName: 'daydream-compose',
        });
        sent = true;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  await db
    .update(daydreamThoughts)
    .set({
      // A failed send is recorded as silent rather than as delivered. Claiming
      // delivery for something that never arrived would corrupt both the rate
      // limits and any later reading of whether this feature works.
      channel: sent ? decision.channel : 'silent',
      status: sent ? 'delivered' : 'suppressed',
      suppressedReason: sent ? null : (decision.suppressedReason ?? `send failed: ${error ?? 'unknown'}`),
      deliveredAt: sent ? now : null,
      updatedAt: now,
    })
    .where(eq(daydreamThoughts.id, thought.id));

  return { sent, error };
}

/** The conversation a chat note would land in — the most recently touched one.
 *  Null when there is none, which makes the chat channel simply unavailable
 *  rather than an error to report. */
export async function latestConversationId(): Promise<string | null> {
  try {
    const { conversations } = await import('$lib/db/schema');
    const [row] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .orderBy(desc(conversations.updatedAt))
      .limit(1);
    return row?.id ?? null;
  } catch {
    return null;
  }
}

/** Is there anywhere to push to? */
export async function hasPushSubscriber(): Promise<boolean> {
  try {
    const { pushSubscriptions } = await import('$lib/db/schema');
    const rows = await db.select({ endpoint: pushSubscriptions.endpoint }).from(pushSubscriptions).limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}
