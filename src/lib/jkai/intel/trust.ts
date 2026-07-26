// Explainable trust for an intel assertion.
//
// The graph used to carry a three-valued `confidence` text column written by
// the extractor's own guesswork, which meant every claim on a card was a bare
// assertion: no provenance, no way to falsify it, no way to disagree with it.
// This module replaces that with a score you can argue with.
//
// The grading is Admiralty-style (NATO STANAG 2511): two INDEPENDENT axes,
// because "who told you" and "does the claim hold up" are different questions.
//   - source reliability  A–F  (A completely reliable … F cannot be judged)
//   - information credibility 1–6 (1 confirmed … 6 cannot be judged)
// Note that F and 6 are NOT the bottom of their scales — they are the absence
// of a judgement. E and 5 are the bottom. That distinction is the whole reason
// an ungraded source must score neutrally rather than badly (see NEUTRAL).
//
// Everything here is pure: no DB, no fetch. The API route and the entity card
// both call it so a hover card and a stored score can never disagree.

export type SourceGrade = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type CredibilityRating = 1 | 2 | 3 | 4 | 5 | 6;
export type TrustLabel = 'high' | 'moderate' | 'low' | 'unverified';

export const SOURCE_GRADES: readonly SourceGrade[] = ['A', 'B', 'C', 'D', 'E', 'F'];
export const CREDIBILITY_RATINGS: readonly CredibilityRating[] = [1, 2, 3, 4, 5, 6];

export const SOURCE_GRADE_LABEL: Record<SourceGrade, string> = {
  A: 'completely reliable',
  B: 'usually reliable',
  C: 'fairly reliable',
  D: 'not usually reliable',
  E: 'unreliable',
  F: 'cannot be judged',
};

export const CREDIBILITY_LABEL: Record<CredibilityRating, string> = {
  1: 'confirmed by other sources',
  2: 'probably true',
  3: 'possibly true',
  4: 'doubtful',
  5: 'improbable',
  6: 'cannot be judged',
};

/**
 * Default reliability per ingest source.
 *
 * The reasoning is about WHO AUTHORED the words, not how they arrived:
 *  - `pwa` / `whatsapp` — John typing or dictating a first-hand observation
 *    into his own capture surfaces. First-party, so A. The claim can still be
 *    wrong; that is what the credibility axis is for.
 *  - `file` — a document deliberately put in the drive. Curated by John but
 *    authored by a third party, so B rather than A.
 *  - `email` — a named correspondent whose identity is verifiable from the
 *    address, but whose claims are their own. B.
 *  - `research` — the deep-research pipeline, which already cross-checks
 *    several web sources before writing a fact. Better than a raw page, but
 *    still machine-summarised, so B.
 *  - `web` — one fetched page of unknown provenance. C.
 *  - `workflow` — an automated pipeline with no human in the loop. C.
 * Anything unrecognised falls to F, which is neutral, not punitive: an
 * unfamiliar source is an unassessed source.
 */
const SOURCE_DEFAULT_GRADE: Record<string, SourceGrade> = {
  pwa: 'A',
  whatsapp: 'A',
  file: 'B',
  email: 'B',
  research: 'B',
  web: 'C',
  workflow: 'C',
};

export function gradeFromSource(source: string): SourceGrade {
  return SOURCE_DEFAULT_GRADE[String(source ?? '').trim().toLowerCase()] ?? 'F';
}

/**
 * The most reliable grade across a set of sources.
 *
 * Deliberately the best rather than the average or the mode: HOW MANY sources
 * assert something is already priced in by the corroboration axis, so asking
 * that axis to also express provenance would double-count breadth. This axis
 * answers a different question — "what is the best provenance behind this at
 * all?" — and one first-hand observation is not diluted by ten scraped pages.
 */
export function bestGrade(sources: readonly string[]): SourceGrade {
  let best: SourceGrade = 'F';
  let bestRank = -1;
  for (const s of sources) {
    const g = gradeFromSource(s);
    const rank = reliabilityFraction(g);
    // Strictly greater, so 'F' (neutral 0.5) never displaces a real 'C'.
    if (g !== 'F' && rank > bestRank) {
      best = g;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * A starting credibility from the number of independent notes asserting a claim.
 * Only a default — a manual grade always wins.
 */
export function credibilityFromCorroboration(corroboration: number): CredibilityRating {
  const n = Math.max(0, Math.floor(corroboration || 0));
  if (n === 0) return 6; // nothing asserts it, so there is nothing to judge
  if (n === 1) return 3; // single uncorroborated source: possibly true
  if (n === 2) return 2;
  return 1; // three or more independent notes: confirmed by other sources
}

/** Weights sum to exactly 1, so a maximally-supported claim scores 1.0. */
const WEIGHTS = {
  reliability: 0.28,
  credibility: 0.22,
  corroboration: 0.3,
  confirmation: 0.2,
} as const;

/**
 * What an unassessed axis contributes. Not 0 — scoring "cannot be judged" the
 * same as "known unreliable" would punish every entity the extractor has not
 * been graded on yet, i.e. almost all of them, and make the whole score a
 * proxy for "has a human been here".
 */
const NEUTRAL = 0.5;

/**
 * Corroboration half-saturation constant: two independent notes gets you half
 * of this axis. Chosen so the curve is steep where it matters (1 → 2 → 3
 * sources is the range real claims live in) and flat after, since the tenth
 * repetition of a claim says far less than the second did.
 */
const CORROBORATION_K = 2;

/**
 * Recency half-life in days.
 *
 * Most of what this graph asserts is role-, project- and affiliation-shaped:
 * who runs what, who works where, what a programme is called. In the civil
 * service and adjacent domains those churn on roughly an 18–24 month cycle, so
 * at one year an uncorroborated claim is about a coin flip — hence a 365-day
 * half-life on the evidence-derived portion of the score.
 */
const HALF_LIFE_DAYS = 365;

/**
 * Decay floor. Old evidence gets weaker, never worthless: the note still
 * exists and still says what it says, and "this entity was real in 2019" is
 * genuine information. Without a floor, a five-year-old fact would round to
 * indistinguishable from a fabrication.
 */
const DECAY_FLOOR = 0.35;

/** Human confirmation does not decay — see computeConfidence. */
const UNDECAYED = ['confirmation'] as const;

export interface ConfidenceInput {
  /** Distinct notes independently asserting the claim. */
  corroboration?: number | null;
  /** A–F. Null/unknown is treated as F (neutral). */
  sourceGrade?: string | null;
  /** 1–6. Null/unknown is treated as 6 (neutral). */
  credibility?: number | null;
  /** Days since the claim was last corroborated. Null/negative counts as fresh. */
  ageDays?: number | null;
  /** A human has reviewed and confirmed the entity. */
  confirmed?: boolean | null;
}

export interface ConfidenceComponents {
  reliability: number;
  credibility: number;
  corroboration: number;
  confirmation: number;
  /** Always ≤ 0 — what age took off the evidence-derived components. */
  recency: number;
}

export interface ConfidenceResult {
  /** 0..1. Equal to the sum of `components`, so the breakdown always reconciles. */
  score: number;
  label: TrustLabel;
  /** The multiplier age applied to the evidence components, 0..1. */
  decay: number;
  components: ConfidenceComponents;
  /** What was actually used, after defaulting — the UI shows these as chips. */
  resolved: {
    sourceGrade: SourceGrade;
    credibility: CredibilityRating;
    corroboration: number;
    ageDays: number;
    confirmed: boolean;
  };
}

export const COMPONENT_LABEL: Record<keyof ConfidenceComponents, string> = {
  reliability: 'source reliability',
  credibility: 'information credibility',
  corroboration: 'corroboration',
  confirmation: 'human confirmation',
  recency: 'age decay',
};

/** A–E map linearly onto 1..0; F is the neutral midpoint, not the bottom. */
export function reliabilityFraction(grade: SourceGrade): number {
  if (grade === 'F') return NEUTRAL;
  return (4 - SOURCE_GRADES.indexOf(grade)) / 4;
}

/** 1–5 map linearly onto 1..0; 6 is the neutral midpoint, not the bottom. */
export function credibilityFraction(rating: CredibilityRating): number {
  if (rating === 6) return NEUTRAL;
  return (5 - rating) / 4;
}

/** Saturating: strictly increasing, asymptotic to 1 — repetition alone is never proof. */
export function corroborationFraction(corroboration: number): number {
  const n = Math.max(0, corroboration);
  return n / (n + CORROBORATION_K);
}

/** Exponential decay to a floor. 1 when fresh. */
export function recencyDecay(ageDays: number): number {
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1;
  return DECAY_FLOOR + (1 - DECAY_FLOOR) * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

export function normalizeGrade(value: unknown): SourceGrade {
  const g = String(value ?? '').trim().toUpperCase();
  return (SOURCE_GRADES as readonly string[]).includes(g) ? (g as SourceGrade) : 'F';
}

export function normalizeCredibility(value: unknown): CredibilityRating {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 1 && n <= 6 ? (n as CredibilityRating) : 6;
}

/**
 * The explainable confidence score.
 *
 * Additive by construction so the breakdown reconciles: the components sum to
 * the score exactly, which is what lets the UI show "0.62 = 0.21 reliability +
 * 0.11 credibility + 0.18 corroboration + 0.20 confirmed − 0.08 age" instead of
 * an unexplained 62%.
 *
 * Age multiplies only the evidence-derived components. A human confirmation
 * does not rot on the same clock as a scraped page — John looking at a claim
 * and saying "yes" stays true until he says otherwise — so it is held out of
 * the decay and the difference is surfaced as the negative `recency` term.
 */
export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  // Guarded against non-finite input: Infinity survives `|| 0` and then turns
  // corroborationFraction into NaN, which would silently zero the whole score.
  const rawCorroboration = Number(input.corroboration ?? 0);
  const corroboration = Number.isFinite(rawCorroboration)
    ? Math.max(0, Math.floor(rawCorroboration))
    : 0;
  const sourceGrade = normalizeGrade(input.sourceGrade);
  const credibility = normalizeCredibility(input.credibility);
  const rawAge = Number(input.ageDays ?? 0);
  const ageDays = Number.isFinite(rawAge) && rawAge > 0 ? rawAge : 0;
  const confirmed = Boolean(input.confirmed);

  const reliability = WEIGHTS.reliability * reliabilityFraction(sourceGrade);
  const credibilityPart = WEIGHTS.credibility * credibilityFraction(credibility);
  const corroborationPart = WEIGHTS.corroboration * corroborationFraction(corroboration);
  const confirmation = confirmed ? WEIGHTS.confirmation : 0;

  const evidence = reliability + credibilityPart + corroborationPart;
  const decay = recencyDecay(ageDays);
  const recency = evidence * (decay - 1);

  const score = clamp01(confirmation + evidence * decay);

  return {
    score,
    label: gradeLabel(score),
    decay,
    components: {
      reliability,
      credibility: credibilityPart,
      corroboration: corroborationPart,
      confirmation,
      recency,
    },
    resolved: { sourceGrade, credibility, corroboration, ageDays, confirmed },
  };
}

/**
 * The score of an entity nothing is known about: both judgement axes neutral,
 * no corroboration, no review. NEUTRAL * (reliability + credibility weights).
 */
export const UNASSESSED_SCORE = NEUTRAL * (WEIGHTS.reliability + WEIGHTS.credibility);

/**
 * Bucketed label for the score. 'unverified' is reserved for the bottom band:
 * it reads as "we have not established this", which is the honest reading of a
 * claim with one anonymous source and no review.
 *
 * The 'low' floor sits just ABOVE UNASSESSED_SCORE deliberately. Neutral
 * defaults put a completely unassessed entity at exactly 0.25, and a threshold
 * at that value would label "we know nothing about this" as "low confidence" —
 * a claim about the evidence that the evidence does not support.
 */
export function gradeLabel(score: number): TrustLabel {
  if (!Number.isFinite(score)) return 'unverified';
  if (score >= 0.75) return 'high';
  if (score >= 0.5) return 'moderate';
  if (score > UNASSESSED_SCORE) return 'low';
  return 'unverified';
}

/** Whole days between two instants, floored at 0. */
export function ageInDays(from: Date | string | number | null | undefined, now = Date.now()): number {
  if (from == null) return 0;
  const t = from instanceof Date ? from.getTime() : new Date(from).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (now - t) / 86_400_000);
}

/** Components ordered for display: positives strongest-first, decay last. */
export function orderedComponents(
  components: ConfidenceComponents,
): Array<{ key: keyof ConfidenceComponents; label: string; value: number }> {
  const entries = (Object.keys(components) as Array<keyof ConfidenceComponents>).map((key) => ({
    key,
    label: COMPONENT_LABEL[key],
    value: components[key],
  }));
  const positives = entries.filter((e) => e.key !== 'recency').sort((a, b) => b.value - a.value);
  const decay = entries.filter((e) => e.key === 'recency');
  return [...positives, ...decay];
}

// ── Evidence presentation ──────────────────────────────────────────────────

/**
 * Split an excerpt around every occurrence of a term, so the evidence list can
 * highlight the claim inside the sentence it came from.
 *
 * Index-based rather than regex-based: an entity name is arbitrary user data
 * ("C++ (2019)"), and building a RegExp out of it is a needless injection and
 * crash surface. Lives in this module rather than in the component because a
 * .svelte file cannot be unit-tested.
 */
export function splitOnTerm(
  text: string | null | undefined,
  term: string | null | undefined,
): Array<{ text: string; hit: boolean }> {
  if (!text) return [];
  const needleRaw = (term ?? '').trim();
  if (!needleRaw) return [{ text, hit: false }];

  const hay = text.toLowerCase();
  const needle = needleRaw.toLowerCase();
  // Case folding can change length for some scripts (İ → i̇), which would
  // misalign every offset. Not worth handling — fall back to no highlight.
  if (hay.length !== text.length || needle.length !== needleRaw.length) {
    return [{ text, hit: false }];
  }

  const out: Array<{ text: string; hit: boolean }> = [];
  let i = 0;
  for (;;) {
    const at = hay.indexOf(needle, i);
    if (at === -1) break;
    if (at > i) out.push({ text: text.slice(i, at), hit: false });
    out.push({ text: text.slice(at, at + needle.length), hit: true });
    i = at + needle.length;
  }
  if (i < text.length) out.push({ text: text.slice(i), hit: false });
  return out;
}

/**
 * The shape /api/jkai/intel/trust returns. Declared here rather than in the
 * route so components can import it without reaching into a `+server.ts`.
 */
export interface TrustEvidence {
  noteId: string;
  title: string;
  source: string;
  /** Default A–F for that source, before any manual override. */
  grade: SourceGrade;
  createdAt: string;
  relevance: string;
  /** The sentence the claim was extracted from. Null on pre-excerpt rows. */
  excerpt: string | null;
  href: string;
}

export interface TrustPayload {
  entity: { id: string; name: string; confirmed: boolean };
  trust: ConfidenceResult;
  /** Whether each axis came from a human override or from the sources. */
  origin: { sourceGrade: 'manual' | 'derived'; credibility: 'manual' | 'derived' };
  lastCorroboratedAt: string | null;
  evidence: TrustEvidence[];
  /** Distinct source notes; `evidence` is capped for display. */
  evidenceCount: number;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Exported for tests and for callers that need to explain the model itself. */
export const TRUST_MODEL = {
  weights: WEIGHTS,
  neutral: NEUTRAL,
  corroborationK: CORROBORATION_K,
  halfLifeDays: HALF_LIFE_DAYS,
  decayFloor: DECAY_FLOOR,
  undecayed: UNDECAYED,
} as const;
