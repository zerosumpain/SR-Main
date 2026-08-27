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

import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
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

/**
 * Try to consume an owner WhatsApp message as thought feedback.
 * Owner-gating happens in the caller (the shared inbound intercept chain runs
 * only for the owner's number), so this concerns itself with shape and state.
 */
export async function interceptDaydreamFeedback(text: string): Promise<WaFeedbackResult> {
  const verdict = matchFeedbackReply(text);
  if (!verdict) return { handled: false };

  const since = new Date(Date.now() - REPLY_WINDOW_HOURS * 3_600_000);
  const [awaiting] = await db
    .select({ id: daydreamThoughts.id, title: daydreamThoughts.title, kind: daydreamThoughts.kind })
    .from(daydreamThoughts)
    .where(
      and(
        inArray(daydreamThoughts.channel, ['whatsapp', 'chat', 'push']),
        eq(daydreamThoughts.status, 'delivered'),
        isNull(daydreamThoughts.feedback),
        gte(daydreamThoughts.deliveredAt, since),
      ),
    )
    .orderBy(desc(daydreamThoughts.deliveredAt))
    .limit(1);

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
