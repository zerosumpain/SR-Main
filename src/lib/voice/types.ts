// The Voice Card — a versioned description of how John writes, built from the
// posts he actually wrote and served to the surfaces that write on his behalf.
//
// Three layers, in descending order of trustworthiness:
//
//   measured — computed from the corpus, so it cannot be hallucinated.
//   stated   — the qualitative spec, written by hand and approved by John.
//   shown    — verbatim excerpts. These do most of the work: models imitate
//              demonstrated text far better than described rules.
//
// Registers exist because "write as John" for a blog post is not the same
// instruction as for a runbook or a chat reply. One card serving all of them is
// the predictable failure, so each register carries its own rules, its own
// measurements where the corpus supports them, and its own exemplars.

export const REGISTERS = ['public-prose', 'explanatory', 'chat', 'terse'] as const;
export type Register = (typeof REGISTERS)[number];

export function isRegister(v: unknown): v is Register {
  return typeof v === 'string' && (REGISTERS as readonly string[]).includes(v);
}

/** A distribution summary. Medians and p90s, never means — a mean hides "short
 *  sentences with the occasional long one", which is the whole shape here. */
export type Spread = {
  median: number;
  p90: number;
  max: number;
};

/** Rates are per 1,000 words so they compare across corpora of different sizes. */
export type Rates = {
  contractions: number;
  firstPerson: number;
  emDash: number;
  semicolon: number;
  colon: number;
  parenthetical: number;
  exclamation: number;
  question: number;
  /** -ise/-our/-re spellings and friends. */
  britishSpellings: number;
  /** Should be 0. Anything above it is a defect, not a trait. */
  americanisms: number;
};

/**
 * A term that shows up more in this corpus than in the contrast corpus, scored
 * by log-odds with an informative Dirichlet prior (Monroe, Colaresi & Quinn).
 * Raw frequency would just return "the, and, of"; the prior is what makes a
 * small corpus usable at all.
 */
export type DistinctiveTerm = {
  term: string;
  /** z-score. Above ~1.96 is the usual "notable" threshold, but see `caveat`. */
  z: number;
  count: number;
};

export type Measured = {
  posts: number;
  words: number;
  sentences: number;
  paragraphs: number;
  fleschReadingEase: number;
  fleschKincaidGrade: number;
  audience: string;
  sentenceWords: Spread;
  paragraphWords: Spread;
  /** Share of sentences of 5 words or fewer, 0–1. Named for what it measures:
   *  detecting true sentence fragments needs a parser, and claiming to have one
   *  would be inventing precision. Short sentences are the observable trait. */
  shortSentenceRate: number;
  rates: Rates;
  distinctive: DistinctiveTerm[];
  /** Present when no term clears the usual significance bar. */
  distinctiveNote?: string;
  /** Present when the corpus is too small for a number to be leaned on. */
  caveat?: string;
};

export type Exemplar = {
  /** Filename under data/voice/exemplars, without the .md. */
  id: string;
  register: Register;
  /** What this passage demonstrates: an opening, an aside, a close, and so on. */
  shows: string;
  sourcePostId: number;
  sourceSlug: string;
  text: string;
};

export type RegisterCard = {
  register: Register;
  /**
   * Whether this register writes *as* John. True for prose and chat; false for
   * changelogs, alerts and triage findings, which should follow his conventions
   * (British English, no marketing language, no invented figures) without
   * putting his personality into a machine-generated line. Getting this wrong in
   * either direction is the failure the register split exists to prevent.
   */
  usesPersona: boolean;
  /** Prose rules. Hand-written; the model reads these verbatim. */
  rules: string[];
  /** Things never to do in this register. */
  avoid: string[];
  /** Absent where the corpus cannot support measurement for this register. */
  measured?: Measured;
  exemplarIds: string[];
};

export type VoiceCard = {
  version: number;
  /** ISO date the numbers were computed. Stamped by the build script. */
  builtAt: string;
  /** Conventions that hold in every register, persona or not. */
  invariants: string[];
  /** Who is speaking. Applied only to registers with `usesPersona`. */
  persona: string[];
  /** Never do these, anywhere. */
  neverDo: string[];
  /**
   * Where the stated layer deliberately disagrees with the measured one, and
   * why. These are the most useful lines in the card: a rule that contradicts
   * the evidence is either an instruction (do as I say) or a mistake, and
   * writing down which keeps the next person from "correcting" it.
   */
  tensions: string[];
  corpus: {
    /** Human-authored posts at or above the prose floor. */
    posts: number;
    words: number;
    /** Posts used as the contrast corpus for distinctiveness. */
    contrastPosts: number;
    contrastWords: number;
    sourceNote: string;
  };
  registers: Record<Register, RegisterCard>;
};
