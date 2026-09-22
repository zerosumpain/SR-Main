/**
 * The notification call every feature already makes.
 *
 * This file was two empty function bodies. Web push was retired, the handler
 * that would have shown a notification lives in an unregistered service worker,
 * and nobody removed the calls — so **twelve call sites across the orchestrator,
 * the autopilot, the briefing and all four chat gates have been notifying
 * nobody for months**. "Autopilot needs you", "Shipped", "Ready for you", a turn
 * waiting on a plan approval: all of it raised, none of it delivered.
 *
 * They are forwarded to `$lib/server/notify` now. Nothing about the call sites
 * changes; what changes is that the alert reaches the notification ledger, and
 * from there whichever channels its category is routed to.
 *
 * **Two deliberate conservatisms**, because turning twelve dormant call sites on
 * at once is exactly how a notification system gets muted on its first day:
 *
 * 1. The `chat` category ships routed to the phone and NOT to WhatsApp. These
 *    calls never reached WhatsApp — they reached nothing — and chat already
 *    escalates there by another path (`wa-escalation.ts`). Sending them would
 *    be doubling a channel, not restoring one.
 * 2. Every forwarded alert carries a dedupe key and a sixty-second floor, so a
 *    burst of identical raises inside one turn collapses to one notification.
 *    Distinct events still each get through.
 *
 * `actions` / `actionEndpoint` / `actionPayload` are accepted and ignored. They
 * described notification action buttons, which needed the service worker that
 * was retired; a local notification posted by the app has no equivalent. They
 * stay in the type so no caller has to change.
 */

import { notifyOwner } from './notify';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  data?: Record<string, unknown>;
  actions?: Array<{ action: string; title: string }>;
  actionEndpoint?: string;
  actionPayload?: Record<string, unknown>;
  /** Explicit routing. Callers that predate the routing table omit it. */
  category?: string;
}

/**
 * Which category an old call site belongs to, from where it points.
 *
 * Deriving it from the URL rather than asking every caller to pass one: the
 * twelve existing sites all carry a `url` that already says what the alert is
 * about, and a mapping in one place is easier to correct than twelve arguments
 * to keep in step. New callers should pass `category` and skip this.
 */
export function categoryForUrl(url: string | undefined): string {
  if (!url) return 'system';
  if (url.startsWith('/jkai/develop')) return 'build';
  if (url.startsWith('/jkai/canvas') || url.startsWith('/jkai/builds')) return 'build';
  if (url.startsWith('/jkai/intel')) return 'intel';
  if (url.startsWith('/jkai')) return 'chat';
  if (url.startsWith('/health')) return 'health';
  if (url.startsWith('/news')) return 'news';
  if (url.startsWith('/admin')) return 'system';
  return 'system';
}

async function forward(payload: PushPayload): Promise<void> {
  await notifyOwner({
    category: payload.category ?? categoryForUrl(payload.url),
    title: payload.title,
    body: payload.body,
    url: payload.url ?? null,
    data: payload.data ?? null,
    // The same sentence about the same thing, twice inside a minute, is one
    // notification. Two different sentences are two.
    dedupeKey: `${payload.title}|${payload.url ?? ''}`,
    minIntervalSeconds: 60,
  });
}

/**
 * There is one user. The parameter is kept so no call site changes, and it is
 * deliberately not used: routing is by category, and an id the ledger has no
 * column for would be a promise this cannot keep.
 */
export async function notifyUser(_userId: string, payload: PushPayload): Promise<void> {
  await forward(payload);
}

export async function notifyAllSubscribers(payload: PushPayload): Promise<void> {
  await forward(payload);
}
