// src/lib/daydream/think/questions.ts
//
// What one think cycle is FOR: a channel, an outcome, and a sentence.
//
// ── Why a question and not a lens ───────────────────────────────────────────
//
// The ponder lens (2026-09-17) rotated what the pack WEIGHTED, and every cycle
// still read the same ~170-card haystack. 74% of first-pass musings were
// echoes, and over 30 days diary/plans took 32% of everything said while chat
// took 0% — there was no chat channel at all. Rotating emphasis over a fixed
// haystack is not rotating attention.
//
// A question is narrower on purpose. It names where the cycle STARTS (the
// channel) and what kind of thing it is trying to produce (the outcome), and
// the cycle then goes and fetches only what that question needs. The channel is
// a starting point, not a fence: "the house's heating against how he slept"
// starts in the house and ends in health, and that is the shape wanted.
//
// ── Even, on two axes at once ───────────────────────────────────────────────
//
// The owner's ask was attention spread EQUALLY across his channels, and the
// outcomes are a second axis with the same requirement. Rotating each
// independently would pair them at random, including pairs that make no sense
// (a build proposal out of a chat thread, money analysis of a heart rate). So
// the pairing is a fixed schedule — each channel gets eight visits per period,
// each outcome gets seven — and the skip table below is what the schedule is
// checked against. Both are pinned by tests.
//
// Clock-derived, like `ponder/lens.ts`: no cursor row to drift, a restart
// cannot reset the rotation, and two boxes agree. PURE — no db, no model.

export const CHANNELS = ['health', 'home', 'mail', 'chat', 'diary', 'money', 'research'] as const;
export type Channel = (typeof CHANNELS)[number];

export const OUTCOMES = [
  'correlate',
  'efficiency',
  'quality_of_life',
  'research',
  'build',
  'health_plan',
  'suggest',
  'money_analysis',
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** The think cadence. The rotation is keyed on it, so changing one without the
 *  other walks the schedule at a different speed rather than breaking it. */
export const THINK_CADENCE_MS = 45 * 60_000;

/**
 * Pairs that make no sense, and why. A pair here never appears in SCHEDULE.
 *
 * The research rule is the one that matters for safety rather than taste: a
 * research cycle reads the open web, so it may hold no private data, so it can
 * only ever produce research or a suggestion — and the research OUTCOME needs
 * the web, so it can only come from a research cycle. See `tools.ts`.
 */
export const SKIP: ReadonlyArray<readonly [Channel, Outcome, string]> = [
  // Research ↔ research/suggest, both ways.
  ['research', 'correlate', 'a research cycle holds no owner data to correlate'],
  ['research', 'efficiency', 'a research cycle holds no owner data'],
  ['research', 'quality_of_life', 'a research cycle holds no owner data'],
  ['research', 'build', 'a build proposal needs the owner data a research cycle cannot hold'],
  ['research', 'health_plan', 'a health plan needs health data a research cycle cannot hold'],
  ['research', 'money_analysis', 'a research cycle holds no owner data'],
  ['health', 'research', 'the research outcome needs the web, which private cycles never get'],
  ['home', 'research', 'the research outcome needs the web'],
  ['mail', 'research', 'the research outcome needs the web'],
  ['chat', 'research', 'the research outcome needs the web'],
  ['diary', 'research', 'the research outcome needs the web'],
  ['money', 'research', 'the research outcome needs the web'],
  // Nonsense pairs.
  ['chat', 'build', 'the spec names it: a chat thread is not a build brief'],
  ['chat', 'health_plan', 'a training week does not start in a chat thread'],
  ['chat', 'money_analysis', 'there is no money in a chat thread'],
  ['health', 'money_analysis', 'there is no money in a heart rate'],
  ['home', 'money_analysis', 'there is no energy-cost data to analyse'],
  ['home', 'suggest', 'an activity or reading suggestion does not start in the sensors'],
  ['mail', 'correlate', 'mail metadata is counts of other people, not his days'],
  ['mail', 'health_plan', 'a training week does not start in the inbox'],
  ['mail', 'suggest', 'mail bodies are never read, so there is nothing to suggest from'],
  ['money', 'health_plan', 'a training week does not start in spend rows'],
  ['money', 'suggest', 'a reading suggestion does not start in spend rows'],
] as const;

const SKIPPED = new Set(SKIP.map(([c, o]) => `${c}|${o}`));

export function isSkipped(channel: Channel, outcome: Outcome): boolean {
  return SKIPPED.has(`${channel}|${outcome}`);
}

/**
 * Each channel's eight visits per period, in order.
 *
 * Solved by hand as a 7 × 8 table whose rows each sum to 8 (every channel an
 * equal share) and whose columns each sum to 7 (every outcome an equal share),
 * with a zero wherever SKIP says so. The research row is forced — the research
 * outcome can only come from here, so seven of its eight visits are research —
 * and the rest follows from it. Within a row, repeats are spread apart so a
 * channel never asks the same kind of question twice running.
 */
export const SCHEDULE: Readonly<Record<Channel, readonly Outcome[]>> = {
  health: ['correlate', 'health_plan', 'quality_of_life', 'build', 'correlate', 'suggest', 'health_plan', 'efficiency'],
  home: ['correlate', 'quality_of_life', 'health_plan', 'efficiency', 'correlate', 'build', 'quality_of_life', 'health_plan'],
  mail: ['money_analysis', 'build', 'efficiency', 'quality_of_life', 'build', 'money_analysis', 'efficiency', 'build'],
  chat: ['suggest', 'quality_of_life', 'correlate', 'suggest', 'efficiency', 'suggest', 'quality_of_life', 'suggest'],
  diary: ['health_plan', 'efficiency', 'money_analysis', 'correlate', 'health_plan', 'quality_of_life', 'suggest', 'health_plan'],
  money: ['money_analysis', 'build', 'correlate', 'money_analysis', 'efficiency', 'money_analysis', 'build', 'money_analysis'],
  research: ['research', 'research', 'research', 'suggest', 'research', 'research', 'research', 'research'],
};

/** Visits per channel per period — the length of every SCHEDULE row. */
export const VISITS_PER_PERIOD = 8;

/** Where each channel starts from. Second person, one clause. */
const CHANNEL_FOCUS: Record<Channel, string> = {
  health:
    'his health — sleep, recovery, HRV, resting heart rate, wrist temperature, daylight, workouts, and what /health itself has concluded (tripwires, moves, experiments, forecasts)',
  home:
    'the house — the Home Assistant sensors, heating, lights, doors and presence, and what they were doing while nobody was looking',
  mail:
    'his mail, as metadata and extracted facts only — who writes, how often, what dated obligations the ingest pulled out (renewals, appointments, deadlines)',
  chat:
    'what he has been asking jkai — the threads he opened, what they were about, when he was up asking them',
  diary:
    'his diary — what is booked, what collides, what the week ahead asks of him',
  money:
    'his money — verified spend rows, what recurs, what renews, what is about to be charged',
  research:
    'his stated interests and notebook topics, read against what the open web says now',
};

/** What each outcome asks for. These are also the outcome DEFINITIONS the
 *  prompt carries, so the rotation and the rules cannot disagree. */
export const OUTCOME_ASK: Record<Outcome, string> = {
  correlate:
    'Find one relationship worth testing between this and another part of his life, and TEST it with correlate() before you say anything. Report the r, n and p you got — a null result on a sensible question is worth saying once.',
  efficiency:
    'Find one concrete thing that is costing him time or effort for nothing, and propose the specific change.',
  quality_of_life:
    'Find one specific thing that would make his days measurably better, from the evidence, and say exactly what to do.',
  research:
    'Pick one interest or notebook topic and find what is genuinely new or useful about it on the web now. Cite the pages.',
  build:
    'Propose one piece of functionality this site could build for him that the evidence shows he would use. Name what it reads, what it does, and what it would have caught.',
  health_plan:
    'Propose the coming week — training, sleep and recovery — from what the data says now, day by day, alongside what /health already recommends.',
  suggest:
    'Suggest one specific activity or thing to read that fits what the evidence shows about him right now, and say why it fits.',
  money_analysis:
    'Find one concrete anomaly or saving in what he actually pays — a duplicate, a renewal, a price change, a charge that stopped — with the figures.',
};

export interface Question {
  channel: Channel;
  outcome: Outcome;
  /** One sentence the prompt leads with. */
  brief: string;
  /** The clock slot this came from, for the pulse. */
  slot: number;
}

/** The slot a moment falls in. Floor, so a slot is a half-open interval. */
export function slotAt(now: Date, cadenceMs = THINK_CADENCE_MS): number {
  return Math.floor(now.getTime() / cadenceMs);
}

/**
 * The question for a slot.
 *
 * Channel is `slot mod 7`, so consecutive cycles walk the channels in order; the
 * outcome is that channel's next visit in SCHEDULE. Over any 56 consecutive
 * slots every channel appears exactly 8 times and every outcome exactly 7.
 *
 * And because a day is exactly 32 slots at 45 minutes, and 32 mod 7 is 4, each
 * day starts the channel walk four places on — so over a week the 07:00–23:00
 * window sees every channel equally too, rather than the same three every
 * morning. Changing the cadence changes that arithmetic; the test checks it.
 */
export function questionForSlot(slot: number): Question {
  const n = CHANNELS.length;
  const channel = CHANNELS[((slot % n) + n) % n];
  const visit = Math.floor(slot / n);
  const row = SCHEDULE[channel];
  const outcome = row[((visit % row.length) + row.length) % row.length];
  return { channel, outcome, brief: briefFor(channel, outcome), slot };
}

export function questionAt(now: Date, cadenceMs = THINK_CADENCE_MS): Question {
  return questionForSlot(slotAt(now, cadenceMs));
}

export function briefFor(channel: Channel, outcome: Outcome): string {
  return `THIS CYCLE STARTS FROM ${CHANNEL_FOCUS[channel]}. ${OUTCOME_ASK[outcome]}`;
}

/** Research cycles read the web and hold no private data. See tools.ts. */
export function isResearchChannel(channel: Channel): boolean {
  return channel === 'research';
}
