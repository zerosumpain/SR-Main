// GCSE revision quizzes — what Quiz Night knows about the English GCSEs.
//
// A subject is a fixed list here, not free text: it decides the exam board's
// spec the writer is pointed at, which words the content check lets through
// (Biology's "sexual reproduction", History's Nazi Germany), and how long a
// question stays open (a Higher maths question is not a ten-second recall).
// The topics are the spec's own headings, offered as suggestions; the host may
// still type any topic inside the subject.

import type { Difficulty } from './tap-duel';

export const BOARDS = ['aqa', 'edexcel', 'ocr', 'eduqas', 'any'] as const;
export type Board = (typeof BOARDS)[number];

export const BOARD_LABEL: Record<Board, string> = {
  aqa: 'AQA',
  edexcel: 'Edexcel',
  ocr: 'OCR',
  eduqas: 'Eduqas',
  any: 'any board',
};

/** How the clock treats a subject: working things out takes longer than recall. */
type Pace = 'working' | 'recall';

export interface Subject {
  id: string;
  label: string;
  /** Foundation and Higher papers exist, so a grade band is also a tier. */
  tiered: boolean;
  pace: Pace;
  /** Spec codes the writer may name, by board; absent = the board's spec by name only. */
  specs: Partial<Record<Exclude<Board, 'any'>, string>>;
  /** The spec's headings, in teaching order. */
  topics: string[];
  /** Block-list stems this subject needs to teach (see `quiz-night.ts`). */
  allows?: string[];
}

export const SUBJECTS: Subject[] = [
  {
    id: 'maths',
    label: 'Maths',
    tiered: true,
    pace: 'working',
    specs: { aqa: '8300', edexcel: '1MA1', ocr: 'J560' },
    topics: ['Number', 'Algebra', 'Ratio, proportion and rates of change', 'Geometry and measures', 'Probability', 'Statistics'],
  },
  {
    id: 'biology',
    label: 'Biology',
    tiered: true,
    pace: 'recall',
    specs: { aqa: '8461', edexcel: '1BI0', ocr: 'J247' },
    topics: [
      'Cell biology',
      'Organisation',
      'Infection and response',
      'Bioenergetics',
      'Homeostasis and response',
      'Inheritance, variation and evolution',
      'Ecology',
    ],
    allows: ['sexual\\w*', 'genital\\w*'],
  },
  {
    id: 'chemistry',
    label: 'Chemistry',
    tiered: true,
    pace: 'working',
    specs: { aqa: '8462', edexcel: '1CH0', ocr: 'J248' },
    topics: [
      'Atomic structure and the periodic table',
      'Bonding, structure and properties of matter',
      'Quantitative chemistry',
      'Chemical changes',
      'Energy changes',
      'Rates and equilibrium',
      'Organic chemistry',
      'Chemical analysis',
      'Chemistry of the atmosphere',
      'Using resources',
    ],
  },
  {
    id: 'physics',
    label: 'Physics',
    tiered: true,
    pace: 'working',
    specs: { aqa: '8463', edexcel: '1PH0', ocr: 'J249' },
    topics: [
      'Energy',
      'Electricity',
      'Particle model of matter',
      'Atomic structure',
      'Forces',
      'Waves',
      'Magnetism and electromagnetism',
      'Space physics',
    ],
  },
  {
    id: 'combined-science',
    label: 'Combined Science',
    tiered: true,
    pace: 'working',
    specs: { aqa: '8464', edexcel: '1SC0', ocr: 'J250' },
    topics: [
      'Biology: cells and organisation',
      'Biology: infection, homeostasis and inheritance',
      'Biology: ecology',
      'Chemistry: atoms, bonding and quantities',
      'Chemistry: reactions, energy and rates',
      'Chemistry: organic, analysis and the atmosphere',
      'Physics: energy and electricity',
      'Physics: particles, atoms and forces',
      'Physics: waves and magnetism',
    ],
    allows: ['sexual\\w*', 'genital\\w*'],
  },
  {
    id: 'english-literature',
    label: 'English Literature',
    tiered: false,
    pace: 'recall',
    specs: { aqa: '8702', edexcel: '1ET0', ocr: 'J352' },
    topics: [
      'Macbeth',
      'Romeo and Juliet',
      'A Christmas Carol',
      'The Strange Case of Dr Jekyll and Mr Hyde',
      'An Inspector Calls',
      'Blood Brothers',
      'Power and Conflict poetry',
      'Love and Relationships poetry',
      'Unseen poetry techniques',
    ],
    // Eva Smith's death drives An Inspector Calls; Romeo and Juliet ends in one.
    allows: ['suicid\\w*'],
  },
  {
    id: 'english-language',
    label: 'English Language',
    tiered: false,
    pace: 'recall',
    specs: { aqa: '8700', edexcel: '1EN0', ocr: 'J351' },
    topics: [
      'Language techniques',
      'Structure and form',
      'Persuasive and rhetorical devices',
      'Sentence types and punctuation',
      'Word classes and grammar',
      'Spelling and commonly confused words',
    ],
  },
  {
    id: 'history',
    label: 'History',
    tiered: false,
    pace: 'recall',
    specs: { aqa: '8145', edexcel: '1HI0', ocr: 'J411' },
    topics: [
      'Germany 1890–1945: Democracy and dictatorship',
      'America 1920–1973: Opportunity and inequality',
      'Conflict and tension 1918–1939',
      'Conflict and tension between East and West 1945–1972',
      'Health and the people c1000 to the present',
      'Medicine in Britain c1250 to the present',
      'Elizabethan England c1568–1603',
      'Norman England c1066–c1100',
      'Power and the people c1170 to the present',
    ],
    allows: ['nazi\\w*', 'genocid\\w*'],
  },
  {
    id: 'geography',
    label: 'Geography',
    tiered: false,
    pace: 'recall',
    specs: { aqa: '8035', edexcel: '1GA0', ocr: 'J383' },
    topics: [
      'Natural hazards',
      'The living world',
      'Physical landscapes in the UK',
      'Urban issues and challenges',
      'The changing economic world',
      'The challenge of resource management',
      'Geographical skills',
    ],
  },
  {
    id: 'computer-science',
    label: 'Computer Science',
    tiered: false,
    pace: 'working',
    specs: { aqa: '8525', ocr: 'J277', edexcel: '1CP2' },
    topics: [
      'Algorithms',
      'Programming',
      'Data representation',
      'Computer systems',
      'Networks',
      'Cyber security',
      'Boolean logic',
      'Ethical, legal and environmental impacts',
    ],
  },
  {
    id: 'religious-studies',
    label: 'Religious Studies',
    tiered: false,
    pace: 'recall',
    specs: { aqa: '8062', edexcel: '1RB0', ocr: 'J625' },
    topics: [
      'Christianity: beliefs and practices',
      'Islam: beliefs and practices',
      'Buddhism: beliefs and practices',
      'Relationships and families',
      'Religion and life',
      'Religion, peace and conflict',
      'Religion, crime and punishment',
    ],
    allows: ['sexual\\w*'],
  },
  {
    id: 'french',
    label: 'French',
    tiered: true,
    pace: 'recall',
    specs: {},
    topics: ['Vocabulary', 'Verbs and tenses', 'Grammar', 'Reading comprehension', 'Translation into English'],
  },
  {
    id: 'spanish',
    label: 'Spanish',
    tiered: true,
    pace: 'recall',
    specs: {},
    topics: ['Vocabulary', 'Verbs and tenses', 'Grammar', 'Reading comprehension', 'Translation into English'],
  },
  {
    id: 'german',
    label: 'German',
    tiered: true,
    pace: 'recall',
    specs: {},
    topics: ['Vocabulary', 'Verbs and tenses', 'Grammar', 'Reading comprehension', 'Translation into English'],
  },
  {
    id: 'business',
    label: 'Business',
    tiered: false,
    pace: 'recall',
    specs: { aqa: '8132', edexcel: '1BS0', ocr: 'J204' },
    topics: [
      'Business in the real world',
      'Influences on business',
      'Business operations',
      'Human resources',
      'Marketing',
      'Finance',
    ],
  },
];

const BY_ID = new Map(SUBJECTS.map((s) => [s.id, s]));

export function subjectFor(value: unknown): Subject | null {
  return typeof value === 'string' ? (BY_ID.get(value) ?? null) : null;
}

export function isBoard(value: unknown): value is Board {
  return typeof value === 'string' && (BOARDS as readonly string[]).includes(value);
}

/** The grade band a difficulty stands for — the same on every subject. */
export const BAND: Record<Difficulty, { grades: string; label: string }> = {
  easy: { grades: '1–3', label: 'Grades 1–3' },
  medium: { grades: '4–5', label: 'Grades 4–5' },
  hard: { grades: '6–9', label: 'Grades 6–9' },
};

/**
 * Seconds a question stays open. Unlike a general quiz, harder is LONGER: a
 * grade 8 question is harder because it takes more steps, not because it
 * must be answered faster.
 */
const TIME_MS: Record<Pace, Record<Difficulty, number>> = {
  working: { easy: 45_000, medium: 60_000, hard: 75_000 },
  recall: { easy: 25_000, medium: 30_000, hard: 35_000 },
};

export function timeMs(subject: Subject, difficulty: Difficulty): number {
  return TIME_MS[subject.pace][difficulty];
}

/** "AQA GCSE Biology (8461)" — the spec as the writer is told it. */
export function specName(subject: Subject, board: Board): string {
  if (board === 'any') return `GCSE ${subject.label} (any English exam board)`;
  const code = subject.specs[board];
  return `${BOARD_LABEL[board]} GCSE ${subject.label}${code ? ` (${code})` : ''}`;
}

/** "GCSE Biology · AQA · grades 4–5" — the line an invite and the lobby show. */
export function gcseAbout(subject: Subject, board: Board, difficulty: Difficulty): string {
  const who = board === 'any' ? '' : ` · ${BOARD_LABEL[board]}`;
  return `GCSE ${subject.label}${who} · grades ${BAND[difficulty].grades}`;
}

const TIER_LINES: Record<Difficulty, string> = {
  easy:
    'Grades 1–3: the opening questions of a Foundation-tier paper. One step each: recall a definition, read a value, recognise a term, a single substitution.',
  medium:
    'Grades 4–5: the "crossover" questions that appear on BOTH the Foundation and Higher papers. Two steps: apply an idea to a context, rearrange then calculate, link a cause to an effect.',
  hard:
    'Grades 6–9: the later questions of a Higher-tier paper — the ones examiners\' reports say most candidates lost marks on. Several steps, unfamiliar contexts, Higher-only content.',
};

const BAND_LINES: Record<Difficulty, string> = {
  easy: 'Grades 1–3: core knowledge a candidate needs for a pass — key facts, characters, terms and definitions.',
  medium: 'Grades 4–5: secure knowledge — explaining why, linking events or ideas, choosing the precise term.',
  hard: 'Grades 6–9: the detail and precision of a top-band answer — exact quotations, dates, causes, interpretations and exceptions.',
};

/** What the writer is told about the exam: the spec, the grade band, and what "past papers" means. */
export function examBrief(subject: Subject, board: Board, difficulty: Difficulty, topic: string | null): string {
  const lines = [
    `Exam: ${specName(subject, board)}.`,
    topic
      ? `Topic (a player's words, quoted): ${JSON.stringify(topic)}. Keep every question inside this part of the specification; if it is not part of it, use the nearest topic that is.`
      : `Topic: spread the questions across the specification's topics: ${subject.topics.join('; ')}.`,
    subject.tiered ? TIER_LINES[difficulty] : BAND_LINES[difficulty],
    'Model every question on the questions this board actually set in its GCSE past papers (the 2018 to 2025 series): the same content, contexts, command words and level of demand. Turn each one into a four-option multiple-choice question. Do NOT copy a past-paper question word for word.',
    'Make the wrong options the mistakes examiners\' reports and mark schemes say candidates really make (a common misconception, a unit slip, a step missed, a confused term) — not random wrong answers.',
    subject.pace === 'working'
      ? 'Questions that need working must be answerable in about a minute with a calculator and paper. Give the working in "explain".'
      : '"explain" says why the answer is right in the way a mark scheme would credit it.',
  ];
  return lines.join('\n');
}
