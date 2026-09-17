// src/lib/daydream/ponder/lens.ts
//
// What this cycle is looking at.
//
// ── The problem this solves ─────────────────────────────────────────────────
//
// The pack was assembled identically every cycle: one fixed table of seats,
// eight times a day, for ever. The calendar and the week ahead hold the largest
// allocations in it, the prompt then asks for "the crossing between cards", and
// the densest thing to cross is dates against dates. Measured on production
// 2026-09-17: of the 41 musings created in 30 days, 35 of the last 41 were the
// `plans` theme — "these two things share 21 September", five times over — and
// the two themes furthest from a diary, `patterns` and `general`, had never
// fired once since they were added on 27 August.
//
// That is not a model being unimaginative. It is a model being handed the same
// haystack every two hours and asked to find a different needle in it.
//
// ── What a lens is ─────────────────────────────────────────────────────────
//
// Two things, and the second matters more than the first:
//
//   1. A reweighting of the card budget, so the cycle's subject gets the seats
//      and the rest keep a floor rather than vanishing. A lens narrows
//      attention; it must never blind the engine to something urgent, so no
//      weight is ever zero and the `present` cards — where he is, how he
//      slept, what is on today — are never reweighted at all.
//
//   2. A SENTENCE in the prompt naming what this cycle is for. A pack is
//      material; a brief is a direction. Telling it "this cycle, look at the
//      house and what its sensors have been doing" costs nothing and is the
//      half that actually moves the output away from date arithmetic.
//
// Six lenses over eight cycles a day means every angle gets looked at daily,
// and the two that had never fired have a cycle of their own rather than
// competing with the diary for the same seats.

/** The angles, in rotation order. Deliberately NOT the musing themes: a lens
 *  is what the engine LOOKS at, a theme is what a finding turns out to be
 *  about, and a house lens very often produces a health musing. Coupling them
 *  would quietly forbid that. */
export const LENSES = ['household', 'money', 'health', 'house', 'knowledge', 'longview'] as const;
export type Lens = (typeof LENSES)[number];

export type PackLimitKey =
  | 'places'
  | 'memoryThemes'
  | 'upcomingEmail'
  | 'recentEmail'
  | 'spendRows'
  | 'offers'
  | 'verdicts'
  | 'weekAhead'
  | 'interests'
  | 'lookups';

export type PackLimits = Record<PackLimitKey, number>;

/** The shipped allocation. A lens multiplies these; with every weight at 1 the
 *  pack is byte-for-byte what it was before lenses existed. */
export const BASE_LIMITS: PackLimits = {
  places: 10,
  memoryThemes: 20,
  upcomingEmail: 12,
  recentEmail: 6,
  spendRows: 10,
  offers: 6,
  verdicts: 8,
  weekAhead: 12,
  interests: 8,
  lookups: 12,
};

/** No category ever disappears. A quiet lens still has to be able to notice a
 *  £400 charge or a cancelled appointment; the lens decides emphasis, not
 *  whether the engine has eyes. */
export const LENS_FLOOR = 2;

const WEIGHTS: Record<Lens, Partial<Record<PackLimitKey, number>>> = {
  // Who is where, and what the week does to five people.
  household: { weekAhead: 1.5, places: 1.5, memoryThemes: 1.2, spendRows: 0.3, offers: 0.3, interests: 0.5 },
  // What has actually been paid, and what is about to be.
  money: { spendRows: 2, offers: 2, recentEmail: 1.5, upcomingEmail: 1.2, weekAhead: 0.5, places: 0.4, interests: 0.4 },
  // Sleep, recovery, movement — and what the engine has already tested about them.
  health: { verdicts: 1.5, memoryThemes: 1.2, weekAhead: 0.5, spendRows: 0.3, offers: 0.3, upcomingEmail: 0.4 },
  // The building and its sensors. The lens that exists because 204 Home
  // Assistant signals were registered and essentially never spoken about.
  house: { places: 1.5, weekAhead: 0.4, spendRows: 0.3, offers: 0.3, upcomingEmail: 0.4, recentEmail: 0.5 },
  // What he is reading, researching and asking — the graph half.
  knowledge: { interests: 2, memoryThemes: 1.5, verdicts: 1.5, weekAhead: 0.4, spendRows: 0.3, offers: 0.3 },
  // The long look: seasons, drift, and what has stopped.
  longview: { verdicts: 1.5, memoryThemes: 1.5, places: 1.2, weekAhead: 0.4, upcomingEmail: 0.4, offers: 0.3 },
};

/** Signal sources this lens wants to hear from first, by key prefix. Empty
 *  means "no preference" — the movers-and-rotation split decides on its own. */
const SIGNAL_PREFERENCE: Record<Lens, string[]> = {
  household: ['journey:'],
  money: [],
  health: ['health:', 'feature:'],
  house: ['ha:', 'weather:'],
  knowledge: ['research:', 'graph:', 'segment:'],
  longview: [],
};

/** The brief. One sentence, in the model's second person, naming the angle and
 *  — as importantly — what NOT to spend the cycle on. */
const BRIEFS: Record<Lens, string> = {
  household:
    'THIS CYCLE, LOOK AT THE HOUSEHOLD: where the five of them actually are and have been, how the week lands across all of them, whose commitments collide. Prefer a crossing that involves someone other than John.',
  money:
    'THIS CYCLE, LOOK AT MONEY: what has been paid, what recurs, what is about to renew, and what an offer or a price in the mail is worth next to what he actually spends. A restatement of a receipt is not a musing.',
  health:
    'THIS CYCLE, LOOK AT HEALTH: sleep, recovery, movement and what the engine has already tested about them. An association that has been tested and came back inconclusive is NOT evidence — say so plainly if you lean on one.',
  house:
    'THIS CYCLE, LOOK AT THE HOUSE AND ITS SENSORS: the readings in the signal cards, what has moved away from its own history, what has stopped reporting, what a room has been doing while nobody was looking at it. This is the angle the engine looks at least and has the most unread data for.',
  knowledge:
    'THIS CYCLE, LOOK AT WHAT HE IS THINKING ABOUT: what he has been asking, reading and researching, what the graph has started to cluster around, and where that meets something in his week. A crossing between an interest and a commitment is the shape to hunt for.',
  longview:
    'THIS CYCLE, TAKE THE LONG VIEW: months rather than days. What has drifted, what has stopped happening, what this time of year has looked like before. An ABSENCE is the most interesting thing you can find here — something that used to recur and has not for weeks.',
};

/**
 * Which lens a cycle gets.
 *
 * Driven by the clock, not stored: there is no cursor row to drift, a restart
 * cannot reset the rotation to `household` for ever, and two boxes running the
 * same cycle would agree. `cycleMs` is the ponder cadence.
 */
export function lensAt(now: Date, cycleMs = 2 * 3_600_000): Lens {
  const cycle = Math.floor(now.getTime() / cycleMs);
  return LENSES[((cycle % LENSES.length) + LENSES.length) % LENSES.length];
}

/** The card budget for a lens. Rounded, floored, never zero. */
export function limitsFor(lens: Lens, base: PackLimits = BASE_LIMITS): PackLimits {
  const w = WEIGHTS[lens] ?? {};
  const out = { ...base };
  for (const key of Object.keys(out) as PackLimitKey[]) {
    const weight = w[key] ?? 1;
    out[key] = Math.max(LENS_FLOOR, Math.round(base[key] * weight));
  }
  return out;
}

/** Signal key prefixes this lens would rather hear about. */
export function signalPreferenceFor(lens: Lens): string[] {
  return SIGNAL_PREFERENCE[lens] ?? [];
}

/** The brief, as prompt lines. */
export function briefFor(lens: Lens): string[] {
  return [BRIEFS[lens], 'This is a direction, not a fence: something genuinely urgent in another part of the pack still beats the angle you were given.'];
}
