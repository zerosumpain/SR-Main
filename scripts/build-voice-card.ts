// Build the Voice Card from the corpus.
//
//   DATABASE_URL=postgresql://... npx tsx scripts/build-voice-card.ts [--write]
//   npx tsx scripts/build-voice-card.ts --corpus corpus.json [--write]
//
// Dry by default: prints what it measured and what would change. `--write`
// commits the result to data/voice/.
//
// The corpus lives in production and homeserv has no direct route to that
// database, so `--corpus` takes an export instead. See docs/voice-corpus.md for
// the exact query. Both paths produce identical output for identical data: the
// build stamp is derived from the corpus rather than the clock, so re-running
// over unchanged input is a no-op diff, not a fresh timestamp.
//
// WHERE THE NUMBERS COME FROM. The `public-prose` register is measured over
// blog posts tagged `authorship='human'` that clear the prose floor — five
// posts as of 2026-08-20. The `chat` register is measured over John's own typed
// turns in `orchestrator_chats` (role='user') on web conversations; WhatsApp
// -sourced threads are excluded outright. `explanatory` and `terse` carry rules
// only: there is no corpus that isolates them, and inventing one by
// reclassifying blog paragraphs would produce numbers with nothing behind them.
//
// The contrast corpus for distinctiveness is the posts tagged `generated`. That
// is deliberately not "generic English": the question this card has to answer is
// what makes John's prose *not model prose*, and the two machine-written posts
// on the site are the closest available statement of what the model does when
// left to write about him. It is a thin contrast — two posts — and the card says
// so in `corpus.sourceNote`.
//
// THIS SCRIPT MUST RUN AGAINST PRODUCTION to produce the real card; homeserv's
// dev database has no posts. It only ever reads.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { measure } from '../src/lib/voice/measure';
import { plainTextFromHtml, countWords } from '../src/lib/blog/readability';
import { CORPUS_AUTHORSHIP, MIN_CORPUS_WORDS } from '../src/lib/blog/authorship';
import type { VoiceCard, Register, RegisterCard, Exemplar } from '../src/lib/voice/types';
import { REGISTERS, isRegister } from '../src/lib/voice/types';

const WRITE = process.argv.includes('--write');
const OUT_DIR = path.resolve('data/voice');
const CARD_PATH = path.join(OUT_DIR, 'voice-card.json');
const EXEMPLAR_DIR = path.join(OUT_DIR, 'exemplars');

const corpusFlagIdx = process.argv.indexOf('--corpus');
const CORPUS_FILE = corpusFlagIdx >= 0 ? process.argv[corpusFlagIdx + 1] : undefined;
const DB = process.env.DATABASE_URL;
if (!DB && !CORPUS_FILE) {
  console.error('Need DATABASE_URL or --corpus <file>. This script only ever reads.');
  process.exit(1);
}

// -- the stated layer ------------------------------------------------------
//
// Hand-written, not derived. This is feedback_public_prose_voice.md promoted
// out of a Claude-only memory file into a repo artefact that every surface
// reads. Edit it here; the build carries it through verbatim.

// Conventions apply everywhere — a changelog line and a blog paragraph should
// both be British English and should both refuse to invent a figure.
const INVARIANTS = [
  'British English throughout: -ise not -ize, -our not -or, whilst and amongst are fine.',
  'Ordinary words. If a plain word will do, it does.',
  'Figures stay exactly as measured. Never invent a number, a date or a quote.',
  'No marketing language, no emoji, no corporate register (leverage, seamless, robust, journey).',
];

// Persona applies only where the surface writes AS John. Putting this into a
// triage finding or an alert would be the register split failing.
const PERSONA = [
  'Write as John, in the first person. Not about him, not as an assistant speaking on his behalf.',
  'Contractions are normal. "It is not" reads as a press release; "it isn\'t" reads as him.',
  'Self-deprecate about effort, never frame a feature as a past mistake.',
  'Humour sits around the numbers, never inside them.',
];

const TENSIONS = [
  'Exclamation marks: the rule says none, the corpus has them at ~3 per 1,000 words. ' +
    'The rule stands anyway — it is an instruction for generated prose, not a description ' +
    'of John. He earns one; a model reaching for one lands it as enthusiasm, which is the ' +
    'exact register being avoided.',
  'Sentence length: the blog assistant prompt has long said "short sentences are fine". ' +
    'Measured, his median sentence is 19 words with a p90 of 43 and only 13% at five words ' +
    'or fewer. He writes long, comma-spliced sentences. A model told to write short ones ' +
    'produces something clipped that reads nothing like him.',
  'Colons: zero in 3,198 words of prose. Not a rule anyone wrote down — just something he ' +
    'never does, and worth not introducing.',
];

const NEVER_DO = [
  'No exclamation marks — see tensions; this is an instruction, not an observation.',
  'No Americanisms — color, organize, gotten, math, center.',
  'No corporate register: leverage, utilise, seamless, robust, best-in-class, journey.',
  'No "It\'s not just X — it\'s Y", and no three-item lists reached for as a rhythm.',
  'No opening throat-clearing: "In today\'s fast-paced world", "Let\'s dive in", "Here\'s the thing".',
  'No em-dash showers. He uses them, but a model told he uses them writes nothing else.',
  'Never invent a number, a date, or a quote.',
];

const REGISTER_RULES: Record<Register, { rules: string[]; avoid: string[] }> = {
  'public-prose': {
    rules: [
      'Headlines carry the wit — tabloid-editorial, sarcastic, punchy. "The site is a rounding error."',
      'The text underneath stays low-key, relaxed and factual. The joke lives in the heading, not the paragraph.',
      'Every narrative line links to value: what it is, why it was added, what it buys. Aimed at a non-technical reader.',
      'One quip at most per passage, preferably high-brow deadpan.',
      'Open flat and declarative. "I built a thing." Not a scene, not a question, not a statistic.',
      'Looseness is a feature. A lowercase sentence opener or a dash where a comma belongs reads as him; sanding it smooth reads as a model.',
      'Long sentences, loosely joined. Median 19 words, p90 43, and commas doing work that full stops would do in tidier prose. Do not chop them up.',
      'Heavy first person — about 46 uses of I/me/my per 1,000 words. He writes about what he did, not about a subject.',
      'No colons in prose. He has never used one in a post; a dash or a full stop instead.',
    ],
    avoid: [
      'A gag in every line — the full-comic register was tried for a week and rejected on 2026-08-17.',
      'Explaining the joke, or signalling one is coming.',
      'Second-person marketing voice ("you\'ll love how...").',
    ],
  },
  explanatory: {
    rules: [
      'Plain English is the default register here, not a toggle-away variant.',
      'Say what a thing is before why it matters, and both before how it works.',
      'Prefer a concrete example over an abstraction. One example beats three adjectives.',
      'It is fine to be dry. Clarity outranks personality on a page someone is reading to get something done.',
    ],
    avoid: [
      'Jokes that cost a reader the thread.',
      'Jargon introduced without being named in plain words first.',
    ],
  },
  chat: {
    rules: [
      'Short. Most of his own messages are under twenty words, and the reply should not tower over the question.',
      'Answer first, then the caveat — never the reverse.',
      'Direct address, no preamble, no "Great question".',
      'A dry aside is welcome; a performance is not.',
    ],
    avoid: [
      'Restating the question before answering it.',
      'Bulleted lists for something that is one sentence.',
      'Closing with an offer of further help.',
    ],
  },
  terse: {
    rules: [
      'One line where one line does. Past tense for what happened, present for what is.',
      'Lead with the thing that changed, not the component it changed in.',
      'No marketing language, no emoji. Sentence case, under 70 characters where it is a title.',
    ],
    avoid: ['Personality. This register is for changelogs and alerts; it should be dull and exact.'],
  },
};

// -- corpus ----------------------------------------------------------------

type PostRow = { id: number; slug: string; authorship: string; content: string };

async function loadCorpus(): Promise<{ posts: PostRow[]; chat: string[] }> {
  if (CORPUS_FILE) {
    const raw = JSON.parse(readFileSync(path.resolve(CORPUS_FILE), 'utf8'));
    return {
      posts: (raw.posts ?? []).slice().sort((a: PostRow, b: PostRow) => a.id - b.id),
      chat: (raw.chat ?? []).filter((c: unknown): c is string => typeof c === 'string'),
    };
  }
  // Imported here rather than at the top so `--corpus` needs no driver at all.
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: DB });
  try {
    const posts = (
      await pool.query('select id, slug, authorship, content from blog_posts order by id')
    ).rows as PostRow[];
    // John's own typed turns. Assistant turns and WhatsApp-sourced threads are
    // excluded — the first is not him, the second is private.
    const chatRows = (
      await pool.query(
        `select o.content
           from orchestrator_chats o
           join jkai_conversations c on c.id = o.conversation_id
          where o.role = 'user' and c.source = 'web'`,
      )
    ).rows as { content: string }[];
    return { posts, chat: chatRows.map((r) => r.content) };
  } finally {
    await pool.end();
  }
}

async function main() {
  const { posts, chat } = await loadCorpus();
  const wordsOf = (html: string) => countWords(plainTextFromHtml(html ?? ''));

  const human = posts.filter(
    (p) => p.authorship === CORPUS_AUTHORSHIP && wordsOf(p.content) >= MIN_CORPUS_WORDS,
  );
  const generated = posts.filter((p) => p.authorship === 'generated');

  if (human.length === 0) {
    console.error(
      'No human-authored posts above the prose floor. Is this pointed at production?',
    );
    process.exit(1);
  }

  const proseMeasured = measure({
    documents: human.map((p) => p.content),
    contrast: generated.map((p) => p.content),
  });

  const chatMeasured = measure({
    documents: chat,
    isHtml: false,
  });

  const exemplars = loadExemplars();

  const registers = Object.fromEntries(
    REGISTERS.map((r): [Register, RegisterCard] => [
      r,
      {
        register: r,
        usesPersona: r === 'public-prose' || r === 'chat' || r === 'explanatory',
        rules: REGISTER_RULES[r].rules,
        avoid: REGISTER_RULES[r].avoid,
        measured:
          r === 'public-prose' ? proseMeasured : r === 'chat' ? chatMeasured : undefined,
        exemplarIds: exemplars.filter((e) => e.register === r).map((e) => e.id),
      },
    ]),
  ) as Record<Register, RegisterCard>;

  const card: VoiceCard = {
    version: 2,
    // Stamped from the corpus, not the clock, so two runs over unchanged data
    // produce byte-identical output and a no-op diff.
    builtAt: buildStamp(human, generated, chat.length),
    invariants: INVARIANTS,
    persona: PERSONA,
    neverDo: NEVER_DO,
    tensions: TENSIONS,
    corpus: {
      posts: human.length,
      words: proseMeasured.words,
      contrastPosts: generated.length,
      contrastWords: measure({ documents: generated.map((p) => p.content) }).words,
      sourceNote:
        `public-prose measured over blog posts tagged '${CORPUS_AUTHORSHIP}' of at least ` +
        `${MIN_CORPUS_WORDS} words (ids ${human.map((p) => p.id).join(', ')}). Distinctive ` +
        `terms are scored against the ${generated.length} post(s) tagged 'generated' ` +
        `(ids ${generated.map((p) => p.id).join(', ')}) — a thin contrast, so read the ` +
        `z-scores as a ranking rather than a significance test. chat measured over ` +
        `${chat.length} of John's own typed turns on web conversations.`,
    },
    registers,
  };

  report(card, human, generated);

  const serialised = JSON.stringify(card, null, 2) + '\n';
  if (!WRITE) {
    const existing = existsSync(CARD_PATH) ? readFileSync(CARD_PATH, 'utf8') : null;
    console.log(
      existing === serialised
        ? '\nDry run: data/voice/voice-card.json is already up to date.'
        : `\nDry run: would ${existing ? 'update' : 'create'} data/voice/voice-card.json. Pass --write.`,
    );
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(CARD_PATH, serialised);
  console.log(`\nWrote ${CARD_PATH}`);
}

/** A content-derived stamp. Using a wall clock here would make every rebuild a
 *  diff even when nothing changed, which turns the committed card into noise. */
function buildStamp(human: PostRow[], generated: PostRow[], chatTurns: number): string {
  const parts = [
    ...human.map((p) => `${p.id}:${p.content.length}`),
    ...generated.map((p) => `g${p.id}:${p.content.length}`),
    `chat:${chatTurns}`,
  ];
  return `corpus-${hash(parts.join('|'))}`;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function loadExemplars(): Exemplar[] {
  if (!existsSync(EXEMPLAR_DIR)) return [];
  const out: Exemplar[] = [];
  for (const file of readdirSync(EXEMPLAR_DIR).filter((f) => f.endsWith('.md')).sort()) {
    const raw = readFileSync(path.join(EXEMPLAR_DIR, file), 'utf8');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) {
      console.warn(`  ! ${file} has no frontmatter — skipped`);
      continue;
    }
    const meta = Object.fromEntries(
      m[1]
        .split('\n')
        .map((line) => line.split(/:\s(.+)/))
        .filter((p) => p.length >= 2)
        .map(([k, v]) => [k.trim(), v.trim().replace(/^["']|["']$/g, '')]),
    );
    if (!isRegister(meta.register)) {
      console.warn(`  ! ${file} has an unknown register '${meta.register}' — skipped`);
      continue;
    }
    out.push({
      id: file.replace(/\.md$/, ''),
      register: meta.register,
      shows: meta.shows ?? '',
      sourcePostId: Number(meta.sourcePostId ?? 0),
      sourceSlug: meta.sourceSlug ?? '',
      text: m[2].trim(),
    });
  }
  return out;
}

function report(card: VoiceCard, human: PostRow[], generated: PostRow[]) {
  const m = card.registers['public-prose'].measured!;
  console.log('Voice Card v%d  (%s)\n', card.version, card.builtAt);
  console.log('CORPUS');
  console.log(`  human posts   ${human.length}  (ids ${human.map((p) => p.id).join(', ')})`);
  console.log(`  words         ${m.words.toLocaleString('en-GB')}`);
  console.log(`  contrast      ${generated.length} generated post(s)`);
  console.log('\nPUBLIC-PROSE, MEASURED');
  console.log(`  readability   FRE ${m.fleschReadingEase}  grade ${m.fleschKincaidGrade}  (${m.audience})`);
  console.log(`  sentence len  median ${m.sentenceWords.median}  p90 ${m.sentenceWords.p90}  max ${m.sentenceWords.max}`);
  console.log(`  paragraph len median ${m.paragraphWords.median}  p90 ${m.paragraphWords.p90}`);
  console.log(`  short sents   ${(m.shortSentenceRate * 100).toFixed(0)}% are <= 5 words`);
  console.log('  per 1,000 words:');
  for (const [k, v] of Object.entries(m.rates)) console.log(`    ${k.padEnd(17)} ${v}`);
  console.log(`  distinctive   ${m.distinctive.slice(0, 12).map((d) => `${d.term}(${d.z})`).join(' ') || '(none)'}`);
  if (m.distinctiveNote) console.log(`                ${m.distinctiveNote.split('. ')[0]}.`);

  console.log('\nSTATED vs MEASURED');
  for (const t of card.tensions) console.log(`  - ${t.split('.')[0]}.`);

  const chat = card.registers.chat.measured;
  if (chat) {
    console.log('\nCHAT, MEASURED');
    console.log(`  turns         ${chat.posts.toLocaleString('en-GB')}`);
    console.log(`  words         ${chat.words.toLocaleString('en-GB')}`);
    console.log(`  sentence len  median ${chat.sentenceWords.median}  p90 ${chat.sentenceWords.p90}`);
    console.log(`  short turns   ${(chat.shortSentenceRate * 100).toFixed(0)}% are <= 5 words`);
  }

  console.log('\nEXEMPLARS');
  for (const r of REGISTERS) {
    const ids = card.registers[r].exemplarIds;
    console.log(`  ${r.padEnd(14)} ${ids.length ? ids.join(', ') : '(none)'}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
