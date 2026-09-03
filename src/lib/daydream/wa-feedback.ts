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
/**
 * A relevance reply: how much the SUBJECT matters, 1..5. A second closed
 * list beside the verdicts, because the two are different instruments —
 * `useful` rules on the suggestion, this on the subject — and a phone
 * needs a way to move the dial that the drill's five buttons give the page.
 *
 * Bare digits are deliberately NOT accepted: an approval reply may be a
 * digit, and the approvals intercept runs first. `rate 4` and `4/5` are
 * unambiguous.
 */
const RELEVANCE_PHRASES: ReadonlyArray<[RegExp, number]> = [
  [/^(really matters|what i care about|top priority)$/, 5],
  [/^(matters|this matters|worth my attention|worth attention|relevant)$/, 4],
  [/^(ordinary|no opinion|neutral)$/, 3],
  [/^(marginal|barely matters|not really)$/, 2],
  [/^(doesn'?t matter|does not matter|not my concern|irrelevant|don'?t care)$/, 1],
  [/^(?:rate|relevance)\s*([1-5])$/, -1],
  [/^([1-5])\s*\/\s*5$/, -1],
];

export function matchRelevanceReply(text: string): number | null {
  const t = (text ?? '').trim().toLowerCase().replace(/[.!]+$/, '');
  if (!t || t.length > 40) return null;
  for (const [re, value] of RELEVANCE_PHRASES) {
    const m = re.exec(t);
    if (!m) continue;
    return value === -1 ? Number(m[1]) : value;
  }
  return null;
}

/** "why" — he wants the evidence behind the last thing it said. */
export function isWhyReply(text: string): boolean {
  const t = (text ?? '').trim().toLowerCase().replace(/[.!?]+$/, '');
  return t === 'why' || t === 'why that' || t === 'evidence' || t === 'show me';
}

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
/** The last thing it said on a phone-shaped channel, inside the window. */
async function lastDelivered(opts: { unrated: boolean }) {
  const since = new Date(Date.now() - REPLY_WINDOW_HOURS * 3_600_000);
  const clauses = [
    inArray(daydreamThoughts.channel, ['whatsapp', 'chat', 'push']),
    inArray(daydreamThoughts.status, ['delivered', 'seen', 'expired', 'archived']),
    gte(daydreamThoughts.deliveredAt, since),
  ];
  if (opts.unrated) clauses.push(isNull(daydreamThoughts.feedback));
  const [row] = await db
    .select({ id: daydreamThoughts.id, title: daydreamThoughts.title, kind: daydreamThoughts.kind, evidence: daydreamThoughts.evidence })
    .from(daydreamThoughts)
    .where(and(...clauses))
    .orderBy(desc(daydreamThoughts.deliveredAt))
    .limit(1);
  return row ?? null;
}

export async function interceptDaydreamFeedback(text: string): Promise<WaFeedbackResult> {
  // Relevance first: the phrase lists do not overlap, and a rating may land
  // on a thought already rated useful.
  const relevance = matchRelevanceReply(text);
  if (relevance != null) {
    const last = await lastDelivered({ unrated: false });
    if (!last) return { handled: false };
    const { setRelevance } = await import('./thought-store');
    await setRelevance(last.id, relevance);
    const { RELEVANCE_TERSE } = await import('./feed-client');
    return {
      handled: true,
      reply: `Noted — "${last.title.slice(0, 60)}" rated ${relevance}/5 (${RELEVANCE_TERSE[relevance]}). That moves how often this kind of thing comes back.`,
    };
  }

  if (isWhyReply(text)) {
    const last = await lastDelivered({ unrated: false });
    if (!last) return { handled: false };
    try {
      const { resolveEvidence } = await import('./evidence');
      const { evidenceLine } = await import('./adjudicate');
      const resolved = await resolveEvidence((last.evidence ?? []) as never);
      const lines = resolved.slice(0, 6).map(evidenceLine);
      return {
        handled: true,
        reply: lines.length
          ? `"${last.title.slice(0, 60)}" rests on:\n${lines.map((l) => `• ${l.slice(0, 160)}`).join('\n')}\n\nFull trail: https://strangeramblings.com/jkai/daydreams/feed?open=${last.id}`
          : `"${last.title.slice(0, 60)}" cites nothing it can show you here — the drill has the reasoning: https://strangeramblings.com/jkai/daydreams/feed?open=${last.id}`,
      };
    } catch {
      return { handled: true, reply: `Could not read the evidence just now. The drill has it: https://strangeramblings.com/jkai/daydreams/feed?open=${last.id}` };
    }
  }

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
