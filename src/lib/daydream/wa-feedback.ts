// src/lib/daydream/wa-feedback.ts
//
// The reply half of WhatsApp delivery — what finally feeds the learning loop.
//
// The owner's D3 decision (2026-08-27) made WhatsApp the push channel, and the
// point of that was never the ping: it was that a WhatsApp REPLY is a feedback
// surface he actually uses, where the web-push actions never had a subscriber
// and the chat link was never followed. This intercepts short verdict replies
// ("useful", "not that", "never", 👍/👎) and records them against the most
// recently delivered thought still awaiting a verdict.
//
// Guard-rails, because a chat message is not a form:
//   • STRICT matcher — a closed phrase list, ≤ 40 chars, nothing fuzzy. "not
//     useful but funny" is conversation, not a verdict, and falls through to
//     normal chat.
//   • Gated on an AWAITING thought — a matching phrase with nothing recently
//     delivered and unrated falls through too. "👍" in an ordinary exchange
//     must never train the weights.
//   • 12-hour window — a verdict should attach to what it was about; a reply
//     a day later is ambiguous and is left to the page's buttons.

import { and, desc, gte, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts } from '$lib/db/schema';

export type WaVerdict = 'useful' | 'not_useful' | 'never_kind';

/** How long after delivery a bare reply still unambiguously means this thought. */
export const REPLY_WINDOW_HOURS = 12;

const USEFUL = new Set(['👍', 'useful', 'helpful', 'good one', 'nice one', 'yes useful']);
const NOT_USEFUL = new Set(['👎', 'not useful', 'not that', 'not helpful', 'no thanks', 'meh']);
const NEVER = new Set(['never', 'never that', 'never this', 'never this kind', 'never these', 'stop these']);

/** PURE. The closed phrase list — matched whole, case-insensitive, or nothing. */
export function matchFeedbackReply(text: string): WaVerdict | null {
  const t = (text ?? '').trim().toLowerCase().replace(/[.!]+$/, '');
  if (!t || t.length > 40) return null;
  if (USEFUL.has(t)) return 'useful';
  if (NOT_USEFUL.has(t)) return 'not_useful';
  if (NEVER.has(t)) return 'never_kind';
  return null;
}

export interface WaFeedbackResult {
  handled: boolean;
  reply?: string;
}

/** Channels a bare reply can be answering: the ones that reach a phone. A
 *  think note raised through `notifyOwner` is stamped `push` whatever route
 *  carried it (`think/run.ts`), which is why `push` is here. */
export const REPLY_CHANNELS: readonly string[] = ['whatsapp', 'chat', 'push'];
/** Statuses a delivered thought can be in and still be the one he means. */
export const REPLY_STATUSES: readonly string[] = ['delivered', 'seen', 'expired', 'archived'];

export interface ReplyCandidate {
  id: string;
  title: string;
  kind: string;
  channel: string | null;
  status: string;
  deliveredAt: Date | null;
  feedback: string | null;
  evidence: unknown;
}

/**
 * PURE. The thought a bare reply is about: the most recently DELIVERED one on
 * a phone-shaped channel inside the window, and — for a verdict — still
 * unrated. No kind filter, deliberately: a think note and an older thought are
 * answered the same way.
 */
export function replyTarget<R extends ReplyCandidate>(rows: R[], now: Date, opts: { unrated: boolean }): R | null {
  const floor = now.getTime() - REPLY_WINDOW_HOURS * 3_600_000;
  let best: R | null = null;
  for (const r of rows) {
    if (!r.deliveredAt || r.deliveredAt.getTime() < floor) continue;
    if (!r.channel || !REPLY_CHANNELS.includes(r.channel)) continue;
    if (!REPLY_STATUSES.includes(r.status)) continue;
    if (opts.unrated && r.feedback) continue;
    if (!best || r.deliveredAt.getTime() > best.deliveredAt!.getTime()) best = r;
  }
  return best;
}

/** Where a thought is read in full. Think notes live on the one feed; an
 *  older thought's room was retired in P4, so it lands on the feed itself. */
export function thoughtLink(t: { id: string; kind: string }): string {
  return t.kind.startsWith('think_')
    ? `https://strangeramblings.com/jkai/daydreams?note=${encodeURIComponent(t.id)}`
    : 'https://strangeramblings.com/jkai/daydreams';
}

/** The last thing it said on a phone-shaped channel, inside the window. The
 *  window is applied in SQL; `replyTarget` makes the choice. */
async function lastDelivered(opts: { unrated: boolean }) {
  const now = new Date();
  const since = new Date(now.getTime() - REPLY_WINDOW_HOURS * 3_600_000);
  const rows = await db
    .select({
      id: daydreamThoughts.id,
      title: daydreamThoughts.title,
      kind: daydreamThoughts.kind,
      channel: daydreamThoughts.channel,
      status: daydreamThoughts.status,
      deliveredAt: daydreamThoughts.deliveredAt,
      feedback: daydreamThoughts.feedback,
      evidence: daydreamThoughts.evidence,
    })
    .from(daydreamThoughts)
    .where(and(inArray(daydreamThoughts.channel, [...REPLY_CHANNELS]), gte(daydreamThoughts.deliveredAt, since)))
    .orderBy(desc(daydreamThoughts.deliveredAt))
    .limit(20);
  return replyTarget(rows, now, opts);
}

/**
 * Try to consume an owner WhatsApp message as thought feedback — the bare
 * verdicts only. (The relevance grammar and "why" replies went with the
 * engine they served, P4 of the 2026-09-25 simplification.) Owner-gating
 * happens in the caller (the shared inbound intercept chain runs only for the
 * owner's number), so this concerns itself with shape and state.
 */
export async function interceptDaydreamFeedback(text: string): Promise<WaFeedbackResult> {
  const verdict = matchFeedbackReply(text);
  if (!verdict) return { handled: false };

  const awaiting = await lastDelivered({ unrated: true });
  if (!awaiting) return { handled: false };

  const { recordFeedback } = await import('./thought-store');
  const { muted } = await recordFeedback(awaiting.id, verdict, undefined, 'explicit');

  const reply =
    verdict === 'never_kind'
      ? `Muted ${muted ? awaiting.kind : 'that kind'} — it won't raise those again. (Un-mute on /jkai/daydreams if you change your mind.)`
      : verdict === 'useful'
        ? `Noted 👍 — "${awaiting.title.slice(0, 60)}" marked useful. It learns from this.`
        : `Noted — "${awaiting.title.slice(0, 60)}" marked not useful. It will aim better.`;

  return { handled: true, reply };
}
