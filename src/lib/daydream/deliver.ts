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
import { DEFAULT_FEED_KINDS, cooldownHoursFor, routeFor, type RouteOverrides } from './routes';

/** At most one interrupting notification in this many hours. */
export const MIN_GAP_HOURS = 3;
/** And at most this many in a local day. */
export const MAX_PER_DAY = 4;
/** The same kind may not interrupt twice inside this window. */
export const PER_KIND_COOLDOWN_HOURS = 20;
/** Nothing buzzes outside these local hours, whatever it scored. */
export const QUIET_HOURS = { start: 8, end: 21 };

export type Channel = 'whatsapp' | 'push' | 'chat' | 'silent';

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

/** Every channel that actually interrupts the owner. Keep this predicate shared
 * by the persisted rate-state reader and tests: adding a preferred transport
 * without adding it here silently resets all limits on the next heartbeat. */
export function isInterruptingChannel(channel: string | null | undefined): boolean {
  return channel === 'whatsapp' || channel === 'push' || channel === 'chat';
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
  const interrupting = rows.filter((r) => isInterruptingChannel(r.channel));

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
/**
 * Kinds that are never pushed, however well they score.
 *
 * The owner's call on the mail lanes (2026-08-28): an account-recovery mail he
 * did not ask for is time-critical and earns a buzz; a price rise and a tax
 * code do not. Expressing that as a routing rule rather than as a score means
 * a quiet week cannot accidentally promote a renewal notice into an
 * interruption just because nothing else was competing for the slot.
 *
 * These still become thoughts, still appear in the feed, and still collect
 * feedback. `feed_only` is a destination, not a suppression, and the page
 * renders it as one.
 */
export const FEED_ONLY_KINDS: ReadonlyArray<string> = DEFAULT_FEED_KINDS;

export function isFeedOnly(kind: string, routes: RouteOverrides = {}): boolean {
  return routeFor(kind, routes) === 'feed';
}

export interface ChannelOpts {
  now: Date;
  /** The adaptive bar — READ again. A verified thought below it is held for
   *  the briefing rather than sent. */
  threshold: number;
  hasPushSubscriber: boolean;
  hasWhatsApp?: boolean;
  /** Owner route overrides by family or kind; defaults apply beneath. */
  routes?: RouteOverrides;
  /** Mean relevance he has given each kind (1..5); absent = neutral. */
  kindRelevance?: ReadonlyMap<string, number>;
}

export function chooseChannel(
  thought: { kind: string; score: number; reviewVerdict?: string | null; kindWeight?: number | null },
  state: RateState,
  opts: ChannelOpts,
): DeliveryDecision {
  const { now } = opts;
  const routes = opts.routes ?? {};

  // ── The review decides whether he hears about it at all ─────────────────
  //
  // Owner's instruction, 2026-08-31: only a thought a model has checked
  // against the sources may reach him. Everything upstream of the reviewer
  // checks that a claim is well FORMED — cites its cards, matches its rule —
  // and none of it asks whether the claim is RIGHT. "You were charged twice
  // for Canva" passes every one of those checks while being an invoice and a
  // bank line describing one payment.
  //
  // Unreviewed is silent, not sent. A thought waits for its verdict; the
  // reviewer runs every few minutes and the interruption budget is 4 a day, so
  // the wait costs nothing and the alternative is delivering exactly the
  // unchecked claims this stage exists to stop.
  if (thought.reviewVerdict === 'refuted') {
    // Not lost — it stays on the feed with the reviewer's reasoning beside it,
    // and the Sunday letter reports what was caught. It simply never
    // interrupts him.
    return { channel: 'silent', suppressedReason: 'refuted_by_review' };
  }
  if (thought.reviewVerdict !== 'verified') {
    return {
      channel: 'silent',
      suppressedReason: thought.reviewVerdict === 'uncertain' ? 'uncertain_after_review' : 'awaiting_review',
    };
  }

  // Verified overrides the threshold, and ONLY the threshold.
  //
  // The threshold was always a proxy for "is this any good" — a cold-start
  // guess that opens at 0.75 and falls as feedback arrives. A reviewer that has
  // gone and read the sources answers that question directly and better, so a
  // verified thought is not held back by a score. Every other gate below
  // stands: quiet hours, the per-kind cooldown, the daily cap and the minimum
  // gap are about how often he may be interrupted, which no verdict changes.
  //
  // Mutes are not here and must never be moved here: `never_kind` is applied in
  // `persistCandidates`, so a muted kind never becomes a thought at all. That
  // ordering is what makes a mute absolute rather than something a confident
  // model can talk past.

  // ── The route, then the policy ───────────────────────────────────────────
  //
  // Checked before the interruption budget, not after: a thought that was
  // never going to buzz must not consume a slot. `feed` waits on the hub;
  // `briefing` waits for the morning card, which reads `briefing_only` back.
  const route = routeFor(thought.kind, routes);
  if (route === 'feed') return { channel: 'silent', suppressedReason: 'feed_only' };
  if (route === 'briefing') return { channel: 'silent', suppressedReason: 'briefing_only' };

  // Owner's ask (2026-09-02): "what gets sent vs what doesn't, linked to
  // relevance". The gate now reads all three instruments. The verdict says
  // the claim is RIGHT; the score against the adaptive bar says the engine
  // thought it worth saying; the kind weight says what he has told it about
  // this KIND — verdicts and relevance ratings in one currency, neutral at
  // 1.0. A verified claim that fails either of the last two is not lost: it
  // is held for the briefing, where a quiet true thing belongs.
  if (thought.score < opts.threshold) {
    return { channel: 'silent', suppressedReason: 'briefing_only' };
  }
  if ((thought.kindWeight ?? 1) < 1) {
    return { channel: 'silent', suppressedReason: 'briefing_only' };
  }

  const hour = localHour(now);
  if (hour < QUIET_HOURS.start || hour >= QUIET_HOURS.end) {
    return { channel: 'silent', suppressedReason: 'quiet_hours' };
  }

  // The cooldown is the second visible effect of the relevance dial: a kind
  // he rates 5 may come back in eight hours, one he rates 1 not for two days.
  const cooldown = cooldownHoursFor(opts.kindRelevance?.get(thought.kind));
  const lastKind = state.lastByKind.get(thought.kind);
  if (lastKind && now.getTime() - lastKind.getTime() < cooldown * 3_600_000) {
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

  // Channel preference (owner's D3, 2026-08-27): WhatsApp is the push
  // channel — it is the one surface where a reply comes back. Web-push stays
  // as the fallback for a device that subscribed; chat is the floor.
  if (opts.hasWhatsApp) return { channel: 'whatsapp', suppressedReason: null };
  if (opts.hasPushSubscriber) return { channel: 'push', suppressedReason: null };
  // Nowhere to push. Chat still reaches a desk, and is not a downgrade the
  // owner needs telling about.
  return { channel: 'chat', suppressedReason: null };
}

/** Send it, and record what happened. One channel per thought, never two. */
export async function deliver(
  thought: {
    id: string;
    kind: string;
    title: string;
    narrative: string | null;
    explanation: string;
    /** The claim as the reviewer restated it, once it had read the sources. */
    reviewNarrative?: string | null;
  },
  decision: DeliveryDecision,
  now: Date,
): Promise<{ sent: boolean; error: string | null }> {
  // The reviewer's wording wins when it supplied one. It is the only sentence
  // here written by something that went and checked, so a restatement it made
  // after reading the invoice must not lose to the phrasing that prompted the
  // check.
  const body = thought.reviewNarrative ?? thought.narrative ?? thought.explanation;
  let sent = false;
  let error: string | null = null;

  if (decision.channel === 'whatsapp') {
    try {
      const { ownerPhone } = await import('$lib/config/owner');
      const to = ownerPhone();
      if (!to) {
        error = 'WORKFLOW_NOTIFY_PHONE unset';
      } else {
        const { executeTool } = await import('$lib/workflows/site-tools/registry');
        // Same transport the briefing uses — the registry handles delegation,
        // so this works identically whether this host or another owns the
        // WhatsApp session.
        const message =
          `💭 *${thought.title.slice(0, 120)}*\n\n${body.slice(0, 500)}\n\n` +
          `Reply 👍 / 👎 / "never" — or rate it: https://strangeramblings.com/jkai/daydreams/feed?rate=${thought.id}`;
        const res = await executeTool('whatsapp_send', { to, message });
        if (res?.success) sent = true;
        else error = (res as { error?: string } | undefined)?.error ?? 'whatsapp_send failed';
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  } else if (decision.channel === 'push') {
    try {
      const { notifyAllSubscribers } = await import('$lib/server/push');
      await notifyAllSubscribers({
        title: thought.title,
        body: body.slice(0, 240),
        url: '/jkai/daydreams/feed',
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
          text: `**${thought.title}**\n\n${body}\n\n${feedbackLine(thought.id)}`,
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

/**
 * The one line that makes a chat note answerable.
 *
 * There are no push subscribers, so every delivery lands here — a bold title
 * and a paragraph, with no way to say anything back. That is why `feedback` is
 * NULL on every thought in production: not indifference, no affordance. And
 * with no feedback the cold-start threshold never falls from its 0.75 ceiling
 * and every kind weight sits at exactly 1.0, so the whole learning apparatus
 * downstream is idling on an empty input.
 *
 * A LINK, not a one-tap verdict URL, and deliberately so: `src/app.html` sets
 * `data-sveltekit-preload-data="hover"` for the entire app, so a GET that
 * records a vote could be fired by a preload the owner never chose — silently
 * training the weights on a mouse movement. The anchor has no side effect; it
 * opens the ledger at this thought, where the verdict buttons already live and
 * a POST records the answer.
 */
export function feedbackLine(thoughtId: string): string {
  return `[Useful? Rate it](/jkai/daydreams/feed?rate=${thoughtId})`;
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

/** Is WhatsApp a live channel? A number to send to is the whole test — the
 *  registry's delegation handles which host actually holds the session, and a
 *  send that still fails is recorded suppressed, never delivered. */
export async function hasWhatsAppOwner(): Promise<boolean> {
  try {
    const { ownerPhone } = await import('$lib/config/owner');
    return ownerPhone() != null;
  } catch {
    return false;
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
