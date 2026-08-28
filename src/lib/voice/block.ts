// Turn the Voice Card into prompt text.
//
// This is the single place a surface gets John's voice from. Before it existed
// the same instructions were retyped in six prompts, had drifted apart, and one
// of them — "short sentences are fine" in the blog assistant — was measurably
// wrong about how he writes.
//
// TWO RULES FOR CALLERS.
//
// 1. OPT IN. There are ~55 `role: 'system'` sites in this repo and roughly 40
//    are extraction, classification or routing. Voice in a JSON extractor makes
//    it worse. Only call this from a surface whose output a person reads as
//    prose.
//
// 2. COMPOSE, DON'T REPLACE. A surface's own rules — a 240-character limit, an
//    <em>-wrapping convention, a required heading order — are not voice and must
//    stay where they are. Add this block alongside them.
//
// WHY THE EXEMPLAR SELECTION IS STABLE AND NOT ROTATED. The original plan said
// to rotate exemplars per call. That is wrong here: a jkai turn ships ~37.5k
// input tokens and relies on OpenRouter prompt caching, which keys on the prompt
// prefix. Varying the system prompt per call would miss the cache every time —
// the same class of mistake as the cache-key churn that once cost ~3.6¢ to say
// "ping". Selection is therefore the first N in the card's declared order, and
// identical across calls. If you want different exemplars, change their order in
// the card.

import type { Register, VoiceCard, Exemplar } from './types';
import { getVoiceCard, getRegisterExemplars } from './card';

export type VoiceBlockOptions = {
  /** How many exemplars to include. 0 for none. Default 2. */
  exemplars?: number;
  /** Include the measured bands. Default true wherever the card has them. */
  bands?: boolean;
  /** Override the heading line. */
  heading?: string;
  /** Cap on prohibition lines. Default 8. */
  maxAvoid?: number;
};

/**
 * Long prohibition lists get followed poorly — past roughly eight "never" lines
 * a model starts treating them as scenery. Register-specific prohibitions come
 * first because they are the ones that surface actually risks breaking; the
 * card-wide list fills whatever is left.
 */
const DEFAULT_MAX_AVOID = 8;

const REGISTER_LABEL: Record<Register, string> = {
  'public-prose': 'public prose — blog posts and project pages',
  explanatory: 'explanatory — docs, briefings, dashboards',
  chat: 'chat — replies to John',
  terse: 'terse — changelogs, alerts, findings',
};

/**
 * The voice instructions for a register, as a prompt fragment.
 *
 * Returns an empty string when no card is built, so a missing card degrades a
 * prompt to its previous behaviour rather than throwing mid-turn.
 */
export function voiceBlock(register: Register, opts: VoiceBlockOptions = {}): string {
  const card = getVoiceCard();
  if (!card) return '';
  return renderVoiceBlock(card, register, getRegisterExemplars(register), opts);
}

/** Pure renderer — exported so tests can drive it without touching the disk. */
export function renderVoiceBlock(
  card: VoiceCard,
  register: Register,
  exemplars: Exemplar[],
  opts: VoiceBlockOptions = {},
): string {
  const rc = card.registers[register];
  if (!rc) return '';

  const wantExemplars = opts.exemplars ?? 2;
  const wantBands = opts.bands ?? true;

  const lines: string[] = [];
  lines.push(opts.heading ?? `VOICE — ${REGISTER_LABEL[register]}`);

  if (rc.usesPersona && card.persona.length > 0) {
    lines.push('', 'Who is speaking:');
    for (const p of card.persona) lines.push(`- ${p}`);
  }

  lines.push('', 'Always:');
  for (const c of card.invariants) lines.push(`- ${c}`);

  if (rc.rules.length > 0) {
    lines.push('', 'In this register:');
    for (const r of rc.rules) lines.push(`- ${r}`);
  }

  const avoid = [...rc.avoid, ...(rc.usesPersona ? card.neverDo : [])].slice(
    0,
    opts.maxAvoid ?? DEFAULT_MAX_AVOID,
  );
  if (avoid.length > 0) {
    lines.push('', 'Never:');
    for (const a of avoid) lines.push(`- ${a}`);
  }

  // Bands that describe the counterpart's writing are guidance about who you are
  // answering, never a target for your own output.
  if (wantBands && rc.measured && rc.bandsDescribeOutput === false) {
    const m = rc.measured;
    lines.push(
      '',
      `Who you are answering: his own messages run about ${m.sentenceWords.median} words, ` +
        `90th percentile ${m.sentenceWords.p90}, and ${Math.round(m.shortSentenceRate * 100)}% are ` +
        `five words or fewer. Match that register — a reply should not tower over the question. ` +
        `These are HIS numbers, not a target for yours.`,
    );
  } else if (wantBands && rc.measured) {
    const m = rc.measured;
    lines.push(
      '',
      `Measured over ${m.words.toLocaleString('en-GB')} words of his own writing. These are` +
        ' bands to stay inside, not targets to hit — writing to the middle of a band is its own tell:',
      `- Sentences run long: median ${m.sentenceWords.median} words, 90th percentile ${m.sentenceWords.p90}. Do not chop them into short ones.`,
      `- Heavy first person: about ${Math.round(m.rates.firstPerson)} uses of I/me/my per 1,000 words.`,
      `- Contractions about ${Math.round(m.rates.contractions)} per 1,000 words.`,
    );
    if (m.rates.colon === 0) lines.push('- He does not use colons in prose. Use a dash or a full stop.');
    if (m.rates.americanisms === 0) lines.push('- Zero Americanisms in the corpus. Keep it that way.');
  }

  const shown = exemplars.slice(0, Math.max(0, wantExemplars));
  if (shown.length > 0) {
    lines.push(
      '',
      'His actual writing. Imitate the texture — the rhythm, the looseness, where the joke sits.' +
        ' Do not reuse the topic, and do not tidy the grammar:',
    );
    for (const e of shown) {
      lines.push('', `[${e.shows}]`, e.text);
    }
  }

  return lines.join('\n');
}

/** Rough token estimate for budgeting. ~4 characters per token is close enough
 *  to catch a block that has grown out of hand. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
