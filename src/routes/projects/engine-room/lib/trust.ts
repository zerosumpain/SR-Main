// trust.ts — content for Memory / "Deciding what to believe".
//
// The scorer below is a faithful re-implementation of the real one
// ($lib/jkai/intel/trust.ts): same weights, same neutral midpoint, same saturation constant,
// same half-life and floor, same rule that human confirmation is held out of the decay.
// Re-declared rather than imported, following lib/memory.ts — a public page must not couple
// to an internal module, and a copy makes a drift a visible diff instead of a silent one.
//
// The grading scheme is the Admiralty System (NATO STANAG 2511): two independent axes,
// because "who told you" and "does the claim hold up" are different questions and collapsing
// them into one number is how a graph ends up asserting things it cannot defend.

export type Grade = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type Credibility = 1 | 2 | 3 | 4 | 5 | 6;

export const GRADES: Grade[] = ['A', 'B', 'C', 'D', 'E', 'F'];
export const CREDIBILITIES: Credibility[] = [1, 2, 3, 4, 5, 6];

export const GRADE_LABEL: Record<Grade, string> = {
  A: 'completely reliable',
  B: 'usually reliable',
  C: 'fairly reliable',
  D: 'not usually reliable',
  E: 'unreliable',
  F: 'cannot be judged',
};

export const CREDIBILITY_LABEL: Record<Credibility, string> = {
  1: 'confirmed by other sources',
  2: 'probably true',
  3: 'possibly true',
  4: 'doubtful',
  5: 'improbable',
  6: 'cannot be judged',
};

/** Weights sum to exactly 1, so a maximally supported claim scores 1.00. */
export const WEIGHTS = {
  reliability: 0.28,
  credibility: 0.22,
  corroboration: 0.3,
  confirmation: 0.2,
} as const;

/** What an unassessed axis contributes. Not zero — see NEUTRAL_NOTE. */
export const NEUTRAL = 0.5;
/** Two independent notes gets you half of the corroboration axis. */
export const CORROBORATION_K = 2;
/** Half-life on the evidence-derived part of the score. */
export const HALF_LIFE_DAYS = 365;
/** Old evidence gets weaker, never worthless. */
export const DECAY_FLOOR = 0.35;

/** A–E map linearly onto 1..0; F is the midpoint, not the bottom. */
export const reliabilityFraction = (g: Grade): number =>
  g === 'F' ? NEUTRAL : (4 - GRADES.indexOf(g)) / 4;

/** 1–5 map linearly onto 1..0; 6 is the midpoint, not the bottom. */
export const credibilityFraction = (c: Credibility): number => (c === 6 ? NEUTRAL : (5 - c) / 4);

/** Saturating, asymptotic to 1 — repetition alone is never proof. */
export const corroborationFraction = (n: number): number =>
  Math.max(0, n) / (Math.max(0, n) + CORROBORATION_K);

export const recencyDecay = (ageDays: number): number =>
  ageDays <= 0 ? 1 : DECAY_FLOOR + (1 - DECAY_FLOOR) * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);

export interface Scored {
  score: number;
  label: 'high' | 'moderate' | 'low' | 'unverified';
  decay: number;
  parts: { reliability: number; credibility: number; corroboration: number; confirmation: number; age: number };
}

/**
 * Additive by construction, so the parts sum to the score exactly. That is what lets the card
 * show "0.62 = 0.21 + 0.11 + 0.18 + 0.20 − 0.08" rather than an unexplained 62%.
 *
 * Age multiplies only the evidence-derived parts. A person looking at a claim and saying yes
 * does not rot on the same clock as a scraped page.
 */
export function score(input: {
  grade: Grade;
  credibility: Credibility;
  corroboration: number;
  ageDays: number;
  confirmed: boolean;
}): Scored {
  const reliability = WEIGHTS.reliability * reliabilityFraction(input.grade);
  const credibility = WEIGHTS.credibility * credibilityFraction(input.credibility);
  const corroboration = WEIGHTS.corroboration * corroborationFraction(input.corroboration);
  const confirmation = input.confirmed ? WEIGHTS.confirmation : 0;

  const evidence = reliability + credibility + corroboration;
  const decay = recencyDecay(input.ageDays);
  const age = evidence * (decay - 1);
  const total = Math.min(1, Math.max(0, confirmation + evidence * decay));

  return {
    score: total,
    label: bandOf(total),
    decay,
    parts: { reliability, credibility, corroboration, confirmation, age },
  };
}

/** An entity nothing is known about: both axes neutral, nothing corroborating, no review. */
export const UNASSESSED = NEUTRAL * (WEIGHTS.reliability + WEIGHTS.credibility);

export const BANDS = [
  { id: 'high', label: 'high', from: 0.75, what: 'Defensible. Several sources, or one good one a person has signed off.' },
  { id: 'moderate', label: 'moderate', from: 0.5, what: 'Worth acting on, worth checking before quoting.' },
  { id: 'low', label: 'low', from: UNASSESSED, what: 'Something is known and it is not much.' },
  { id: 'unverified', label: 'unverified', from: 0, what: 'Nothing has been established. The honest reading of one anonymous source and no review.' },
] as const;

export function bandOf(s: number): 'high' | 'moderate' | 'low' | 'unverified' {
  if (s >= 0.75) return 'high';
  if (s >= 0.5) return 'moderate';
  if (s > UNASSESSED) return 'low';
  return 'unverified';
}

/** Default credibility from how many independent notes assert the claim. */
export function credibilityFromCorroboration(n: number): Credibility {
  if (n <= 0) return 6;
  if (n === 1) return 3;
  if (n === 2) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// The arguments the page has to make
// ---------------------------------------------------------------------------

export const NEUTRAL_NOTE = {
  title: 'F is the middle of the scale, not the bottom',
  body:
    'E is unreliable. F is “cannot be judged” — the absence of a verdict. Scoring the two the same would punish every entity nobody has graded yet, which is nearly all of them, and turn the whole number into a proxy for “has a human been here”. So an unassessed axis contributes the midpoint.',
} as const;

export const SATURATION_NOTE = {
  title: 'The tenth source says far less than the second',
  body:
    'Corroboration saturates rather than accumulating: it is the heaviest single term, and a term that kept growing would let anything repeated often enough outscore something a person had checked. Two independent notes buys half the axis. Nothing buys all of it.',
} as const;

export const DECAY_NOTE = {
  title: 'Old evidence fades; a human decision does not',
  body:
    'Roles, affiliations and programme names churn on roughly a two-year cycle, so at a year an uncorroborated claim is about a coin flip — hence a one-year half-life on the evidence. It is floored, because “this was true in 2019” is genuine information. Confirmation is held out of the decay entirely: it stays true until you say otherwise.',
} as const;

export const WHY_A_SCORE = {
  title: 'Why a score rather than a label',
  body:
    'High, medium and low are cheap to compute and impossible to argue with: there is nothing inside them to point at. A weighted sum costs the same to store and carries its own reasons, so “why is this only 0.4?” has an answer with five parts, and each of them can be disagreed with on its own terms.',
} as const;

/** Worked cases the bench opens with. Neutral stand-ins, as everywhere in this study. */
export const CASES = [
  {
    id: 'header', label: 'A name off a mail header',
    grade: 'B' as Grade, credibility: 2 as Credibility, corroboration: 4, ageDays: 6, confirmed: false,
    story: 'Four threads name the same correspondent this fortnight. Nobody has reviewed it and nobody needs to: corroboration and freshness carry it on their own.',
  },
  {
    id: 'onepage', label: 'One web page, once',
    grade: 'C' as Grade, credibility: 3 as Credibility, corroboration: 1, ageDays: 40, confirmed: false,
    story: 'A single fetched page asserting something nothing else does. This is the shape of a claim that reads as fact on a card and should not.',
  },
  {
    id: 'confirmed', label: 'Old, thin, and confirmed by hand',
    grade: 'C' as Grade, credibility: 3 as Credibility, corroboration: 1, ageDays: 500, confirmed: true,
    story: 'The evidence has decayed for well over a year and the human confirmation has not moved at all. Almost the whole score is now the sign-off.',
  },
  {
    id: 'blank', label: 'Nothing known at all',
    grade: 'F' as Grade, credibility: 6 as Credibility, corroboration: 0, ageDays: 0, confirmed: false,
    story: 'Both axes neutral, nothing asserting it. It lands on the unverified boundary exactly — the floor of “low” sits just above this, so “we know nothing” is never dressed up as “low confidence”.',
  },
] as const;
