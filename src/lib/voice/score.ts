// Does this text sound like John?
//
// A deterministic scorer — no LLM, no network, so it costs nothing and returns
// the same answer twice. It exists to turn "the prompt says write like John"
// into something checkable, and to give the generation loops a gate they can
// actually fail.
//
// WHAT IT CAN AND CANNOT DO. It measures surface habits: pronoun density,
// punctuation, sentence shape, spelling, a short list of constructions that read
// as machine-written. It cannot judge whether a sentence is any good, whether a
// joke lands, or whether a claim is true. A high score means "nothing here
// contradicts his measured habits", not "this is well written".
//
// TWO DELIBERATE RESTRAINTS, both from the plan:
//
//   Hard failures are reserved for deterministic defects — an Americanism, a
//   -ize spelling, a banned construction. These are wrong regardless of corpus
//   size. Statistical traits only ever warn, because with five posts behind them
//   they describe those posts as much as they describe him.
//
//   Bands come from the card, not from constants here. When the corpus grows and
//   the numbers move, the scorer moves with them. The tolerances below are
//   multipliers on measured values, not thresholds pretending to be facts.

// No import of ./card here, deliberately: that reads the filesystem, and this
// module runs in the browser too — the editor's Voice panel scores as you type.
// The card is passed in instead; `$lib/voice/score.server` supplies it on the
// server, and the editor gets it from its page loader.
import type { Register, VoiceCard } from './types';
import { extractParagraphs, splitSentences } from './measure';
import { plainTextFromHtml, readability, countWords } from '../blog/readability';

export type Severity = 'fail' | 'warn' | 'note';

export type Finding = {
  severity: Severity;
  /** Stable identifier, for tests and for grouping in the UI. */
  code: string;
  message: string;
  /** The offending text, where there is a specific one. */
  evidence?: string;
};

export type VoiceScore = {
  /** 0–100. Starts at 100 and pays for each finding. */
  score: number;
  verdict: 'in voice' | 'drifting' | 'not his voice';
  findings: Finding[];
  /** What was measured, so a caller can show the numbers behind the verdict. */
  observed: {
    words: number;
    sentenceMedian: number;
    fleschReadingEase: number;
    firstPerson: number;
    contractions: number;
    emDash: number;
    colon: number;
    lowercaseOpeners: number;
  };
};

const PENALTY: Record<Severity, number> = { fail: 25, warn: 12, note: 0 };

/** Below this many words the surface habits are too sparse to read, and the
 *  scorer says so rather than returning a confident number about a sentence. */
const MIN_SCOREABLE_WORDS = 60;

// -- deterministic defects -------------------------------------------------

const AMERICANISM =
  /\b(?:color|colors|colored|organize|organized|organizing|organization|recognize|recognized|analyze|analyzed|behavior|behaviors|favorite|favorites|center|centers|defense|offense|gotten|realize|realized|specialty|traveled|traveling|canceled|labeled|modeling)\b/gi;

/**
 * -ize spellings, as an explicit stem list rather than a pattern.
 *
 * A pattern is the obvious approach and it is wrong: `\w+i[sz]?ze` happily
 * matches "size", "prize", "seize" and "capsize", none of which have an -ise
 * form. It flagged John's own writing on the first run. English has genuine
 * -ize words, so the only safe test is a list of stems whose British form really
 * is -ise.
 */
const IZE_STEMS = [
  'organi', 'recogni', 'reali', 'apologi', 'critici', 'emphasi', 'minimi', 'maximi',
  'optimi', 'prioriti', 'summari', 'utili', 'categori', 'characteri', 'speciali',
  'standardi', 'visuali', 'normali', 'moderni', 'digiti', 'central i'.replace(' ', ''),
  'authori', 'customi', 'final i'.replace(' ', ''), 'legiti mi'.replace(' ', ''),
];
const IZE_SPELLING = new RegExp(
  `\\b(?:${IZE_STEMS.join('|')})z(?:e|es|ed|ing|ation|ations)\\b`,
  'gi',
);

/** Constructions that read as machine-written whoever wrote them. */
const BANNED: { code: string; re: RegExp; message: string }[] = [
  {
    code: 'not-just-x-its-y',
    // Must match the uncontracted form too — "It is not just X — it is Y" is the
    // same sentence and a model writing formally produces exactly that.
    re: /\b(?:it'?s|it is|this is|that'?s|that is)\s+not\s+(?:just|only|merely)\b[^.!?]{0,80}?[—,-]\s*(?:it'?s|it is)\b/gi,
    message: '"It\'s not just X — it\'s Y" is the single most model-shaped sentence there is.',
  },
  {
    code: 'throat-clearing',
    // "when it comes to" was here and had to go — it is ordinary English and it
    // fired on John's own post about this very system.
    re: /\b(?:in today'?s (?:fast[- ]paced )?world|let'?s dive in|here'?s the thing|at the end of the day)\b/gi,
    message: 'Opening throat-clearing. Start with the thing itself.',
  },
  {
    code: 'corporate-register',
    // "robust" is deliberately absent: John uses it plainly, and the first run
    // flagged his own post for it. A word he actually writes is not a defect.
    re: /\b(?:leverage|leveraging|seamless(?:ly)?|best[- ]in[- ]class|game[- ]chang(?:er|ing)|cutting[- ]edge|synerg(?:y|ies)|delve into|it'?s worth noting|unlock(?:ing)? the power)\b/gi,
    message: 'Corporate register. Use the ordinary word.',
  },
  {
    code: 'assistant-tell',
    re: /\b(?:great question|i'?d be happy to|certainly[,!]|as an ai|i hope this helps|feel free to)\b/gi,
    message: 'Assistant filler. He is not an assistant.',
  },
];

function matches(text: string, re: RegExp): string[] {
  return Array.from(text.matchAll(re), (m) => m[0]);
}

const per1000 = (n: number, words: number) => (words === 0 ? 0 : (n / words) * 1000);

/**
 * Score `text` against a register of the Voice Card.
 *
 * With no card the scorer still catches every deterministic defect and says the
 * bands were unavailable, rather than inventing thresholds.
 */
export function scoreVoice(
  text: string,
  register: Register = 'public-prose',
  card: VoiceCard | null = null,
): VoiceScore {
  const paragraphs = extractParagraphs(text);
  const plain = paragraphs.join('\n\n') || plainTextFromHtml(text);
  const sentences = paragraphs.flatMap(splitSentences);
  const words = countWords(plain);

  const sentenceWordCounts = sentences.map(countWords).filter((n) => n > 0);
  const sorted = [...sentenceWordCounts].sort((a, b) => a - b);
  const sentenceMedian = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const scores = readability(plain);

  const firstPerson = per1000(matches(plain, /\b(?:I|I['’](?:m|ve|d|ll)|me|my|mine|myself)\b/g).length, words);
  const contractions = per1000(matches(plain, /\b[a-z]+['’](?:s|t|re|ve|ll|d|m)\b/gi).length, words);
  const emDash = per1000(matches(plain, /—/g).length, words);
  const colon = per1000(matches(plain, /:/g).length, words);
  const lowercaseOpeners = sentences.filter((s) => /^[a-z]/.test(s.trim())).length;

  const observed = {
    words,
    sentenceMedian,
    fleschReadingEase: scores.fleschReadingEase,
    firstPerson: round2(firstPerson),
    contractions: round2(contractions),
    emDash: round2(emDash),
    colon: round2(colon),
    lowercaseOpeners,
  };

  const findings: Finding[] = [];

  // --- deterministic defects: always hard, whatever the corpus size ---------
  for (const a of new Set(matches(plain, AMERICANISM).map((m) => m.toLowerCase()))) {
    findings.push({ severity: 'fail', code: 'americanism', message: `"${a}" is an Americanism.`, evidence: a });
  }
  // Words already named as Americanisms are not repeated as -ize spellings.
  // "organization" is both, and reporting it twice is noise in a panel the
  // author reads at a glance.
  const alreadyFlagged = new Set(matches(plain, AMERICANISM).map((m) => m.toLowerCase()));
  for (const z of new Set(matches(plain, IZE_SPELLING).map((m) => m.toLowerCase()))) {
    if (alreadyFlagged.has(z)) continue;
    findings.push({ severity: 'fail', code: 'ize-spelling', message: `"${z}" should use -ise.`, evidence: z });
  }
  for (const b of BANNED) {
    const hit = matches(plain, b.re)[0];
    if (hit) findings.push({ severity: 'fail', code: b.code, message: b.message, evidence: hit });
  }

  const persona = card?.registers[register]?.usesPersona ?? true;
  const measured = card?.registers[register]?.measured;

  if (words < MIN_SCOREABLE_WORDS) {
    findings.push({
      severity: 'note',
      code: 'too-short',
      message: `Only ${words} words — too short to read habits from. Deterministic checks still applied.`,
    });
    return finish(observed, findings);
  }

  if (!measured) {
    findings.push({
      severity: 'note',
      code: 'no-bands',
      message: 'No measured bands for this register, so only the deterministic checks ran.',
    });
    return finish(observed, findings);
  }

  // --- statistical traits: warn only ---------------------------------------
  // Tolerances are wide on purpose. Five posts describe those posts as much as
  // they describe the author, and a scorer that fails on a 5-sample band would
  // mostly be measuring its own confidence.

  if (persona && firstPerson < measured.rates.firstPerson * 0.35) {
    findings.push({
      severity: 'warn',
      code: 'impersonal',
      message:
        `Barely any first person (${observed.firstPerson} per 1,000 words against his ` +
        `${Math.round(measured.rates.firstPerson)}). He writes about what he did, not about a subject.`,
    });
  }

  if (persona && contractions < measured.rates.contractions * 0.35) {
    findings.push({
      severity: 'warn',
      code: 'formal',
      message: `Few contractions (${observed.contractions} per 1,000 against his ${Math.round(measured.rates.contractions)}). Reads written rather than spoken.`,
    });
  }

  if (emDash > Math.max(measured.rates.emDash * 2, 9)) {
    findings.push({
      severity: 'warn',
      code: 'em-dash-shower',
      message: `Em-dashes at ${observed.emDash} per 1,000 words, well above his ${measured.rates.emDash}. The tell of a model told he likes them.`,
    });
  }

  if (measured.rates.colon === 0 && colon > 0) {
    findings.push({
      severity: 'warn',
      code: 'colon',
      message: `${Math.round((colon * words) / 1000)} colon(s). He has never used one in a post.`,
    });
  }

  const lowBand = Math.max(8, measured.sentenceWords.median * 0.55);
  const highBand = measured.sentenceWords.p90 * 1.2;
  if (sentenceMedian < lowBand) {
    findings.push({
      severity: 'warn',
      code: 'chopped',
      message: `Median sentence is ${sentenceMedian} words; his is ${measured.sentenceWords.median}. Too clipped — he writes long and comma-spliced.`,
    });
  } else if (sentenceMedian > highBand) {
    findings.push({
      severity: 'warn',
      code: 'ponderous',
      message: `Median sentence is ${sentenceMedian} words, past even his 90th percentile of ${measured.sentenceWords.p90}.`,
    });
  }

  const fre = scores.fleschReadingEase;
  if (fre > measured.fleschReadingEase + 10) {
    findings.push({
      severity: 'warn',
      code: 'too-easy',
      message: `Reads far easier than he does (${fre} against ${measured.fleschReadingEase}). Simple to the point of chirpy.`,
    });
  } else if (fre < measured.fleschReadingEase - 10) {
    findings.push({
      severity: 'warn',
      code: 'too-dense',
      message: `Reads far denser than he does (${fre} against ${measured.fleschReadingEase}).`,
    });
  }

  // --- positive evidence ----------------------------------------------------
  // Absence is not penalised: plenty of his paragraphs are tidy. Presence is
  // hard to fake and worth saying out loud.
  if (persona && lowercaseOpeners > 0) {
    findings.push({
      severity: 'note',
      code: 'looseness',
      message: `${lowercaseOpeners} sentence(s) open lowercase — the looseness that reads as him. Do not tidy it.`,
    });
  }

  return finish(observed, findings);
}

function finish(observed: VoiceScore['observed'], findings: Finding[]): VoiceScore {
  const penalty = findings.reduce((sum, f) => sum + PENALTY[f.severity], 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));

  // The verdict weighs BREADTH as well as total penalty. Text that contradicts
  // three separate measured habits is not his, whatever the arithmetic says —
  // one bad habit is a slip, three at once is a different writer. Judging on the
  // point total alone let a post with no first person, an em-dash shower, colons
  // he never uses and the wrong density read as merely "drifting".
  const warnings = findings.filter((f) => f.severity === 'warn').length;

  const verdict: VoiceScore['verdict'] =
    score < 45 || warnings >= 3
      ? 'not his voice'
      : score < 75 || warnings >= 1
        ? 'drifting'
        : 'in voice';

  return { score, verdict, findings, observed };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
