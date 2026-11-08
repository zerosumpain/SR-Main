// src/lib/daydream/reasons.ts
//
// WHY he answered a note the way he did, in one tap. PURE.
//
// In the think loop's first 22 days he gave 86 verdicts and one reason (and
// that one, "did it", was written by "Do it for me", not by him). So the loop
// learnt only "yes" and "no": a note he already knew, one that came on a bad
// day, and one about something he does not care for all moved the same weight
// the same way. The reasons separate them:
//
//   already_knew   — a "no" for the note. It also tells the loop what is not
//                    news to him, so the title rides in the prompt's taste block.
//   not_my_thing   — a "no", and a taste: fewer like this.
//   not_now        — NOT a "no". The note is filed away (expired) with no
//                    verdict, so the kind's weight does not move.
//   did_it         — a "yes", and he acted on it.
//
// "It's wrong" is not here: that is a ruling on the claim with a reason he
// writes (`owner-verdict.ts`), and the card opens that form instead.
//
// Stored in `feedback_note` as the bare code — the column the verdict writer
// already fills, and that nothing else reads — so no schema change.

export const REASONS = ['already_knew', 'not_my_thing', 'not_now', 'did_it'] as const;
export type Reason = (typeof REASONS)[number];

export const REASON_LABEL: Record<Reason, string> = {
  already_knew: 'Already knew',
  not_my_thing: 'Not my thing',
  not_now: 'Not now',
  did_it: 'Did it',
};

/** What a reason does to the note's verdict. `null` clears it. */
export const REASON_VERDICT: Record<Reason, 'useful' | 'not_useful' | null> = {
  already_knew: 'not_useful',
  not_my_thing: 'not_useful',
  not_now: null,
  did_it: 'useful',
};

/** The reasons that go with each verdict, for the card's follow-up row. */
export const REASONS_AFTER: Record<'useful' | 'not_useful', readonly Reason[]> = {
  useful: ['did_it'],
  not_useful: ['already_knew', 'not_now', 'not_my_thing'],
};

export function isReason(v: unknown): v is Reason {
  return typeof v === 'string' && (REASONS as readonly string[]).includes(v);
}

/** The reason in a stored `feedback_note`, or null. "did it" is what
 *  `act.server.ts` writes when "Do it for me" succeeds. */
export function reasonOf(note: string | null | undefined): Reason | null {
  if (!note) return null;
  const t = note.trim().toLowerCase();
  if (t === 'did it') return 'did_it';
  return isReason(t) ? t : null;
}

/** A "no" reason: the ones the interest picker and taste block count. */
export function isDecline(reason: Reason | null): boolean {
  return reason === 'already_knew' || reason === 'not_my_thing';
}

export interface TasteRow {
  title: string;
  reason: Reason;
}

/** How many titles ride in the prompt's taste block. */
export const TASTE_IN_PROMPT = 12;

/** The prompt block: what he has said is not news, or not for him. Empty when
 *  there is nothing to say. Newest first in. */
export function tasteLines(rows: readonly TasteRow[]): string[] {
  const knew = rows.filter((r) => r.reason === 'already_knew').slice(0, TASTE_IN_PROMPT / 2);
  const notHis = rows.filter((r) => r.reason === 'not_my_thing').slice(0, TASTE_IN_PROMPT / 2);
  if (!knew.length && !notHis.length) return [];
  return [
    'WHAT HE HAS TOLD YOU IS NOT WORTH SAYING. Do not write another note like these:',
    ...knew.map((r) => `  • He already knew: "${r.title}"`),
    ...notHis.map((r) => `  • Not his thing: "${r.title}"`),
  ];
}
