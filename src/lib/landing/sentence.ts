// sentence.ts — the landing hero's one sentence, as data.
//
// The hero reads the site's live numbers out as a paragraph instead of a
// table: "It's 12° out. My heart is keeping time at 52 beats a minute…". Each
// number is a value word the reader can tap for its footnote, and every state
// a number can be in (no reading yet, a stale one, a recorded zero, the
// daydreamer outside its hours) has its own wording here rather than a dash
// in a cell. Pure: no DOM and no clock of its own, so the server and the
// browser build the same words from the same inputs, and each honest state is
// a unit test (sentence.test.ts).
//
// Voice: John's. Dry, British, lower key; the heart rate is the Apple Watch's,
// never Whoop's; and nothing here says where he is or whether anyone is home.

import { HEALTH_TIMEZONE } from '$lib/constants/health-day';
import { isStale, roundPulse, type VitalsState } from '$lib/vitals/state';
import type { CapabilityFacts } from './capabilities';
import type { LandingVitals } from './live-vitals.svelte';

/** The five value words, in reading order; a word's footnote number is its place here plus one. */
export const NOTES = ['pulse', 'steps', 'daydream', 'ship', 'releases'] as const;
export type NoteId = (typeof NOTES)[number];

/**
 * One clause of the sentence, built around its value word:
 * `lead` + word + `tail` + (`aside`) + `end`, then the word's footnote.
 */
export interface Clause {
  id: NoteId;
  /** Text before the value word, leading space included. */
  lead: string;
  /** The value word as shown. */
  word: string;
  /** Said instead of `word` by a screen reader, when the word is only a dash. */
  spoken?: string;
  /** Text after the value word, before any aside. Empty when punctuation follows at once. */
  tail: string;
  /** An italic aside, shown in brackets. */
  aside?: string;
  /** The clause's closing punctuation; the footnote opens after it. */
  end: ',' | '.';
}

export interface Sentence {
  /** "It’s 12° out." or nothing, when the weather has not come in. */
  opening: string;
  clauses: Clause[];
  /** A closing remark with no value word, e.g. when the release record is unreachable. */
  closing: string;
}

/* ------------------------------------------------------------------ pulse */

/**
 * The heart rate as the hero may state it. `fresh` is a real reading from the
 * last six hours; `stale` is a real one that is older; `none` covers both "no
 * reading has ever arrived" and "the page has not been told yet".
 */
export type Pulse =
  | { state: 'fresh'; bpm: number; at: string }
  | { state: 'stale'; at: string }
  | { state: 'none' };

/**
 * Reads the pulse off the vitals feed's TARGET state (never the eased one,
 * which counts up from a placeholder 60). Only the heart-rate reading's own
 * time counts: `lastSyncedAt` can be a WHOOP recovery row's, which would make
 * an old pulse look fresh and a missing one look present.
 */
export function readPulse(r: Pick<VitalsState, 'pulse' | 'pulseAt'> | null | undefined, now: number): Pulse {
  const at = r?.pulseAt;
  const t = at ? Date.parse(at) : NaN;
  if (!at || !Number.isFinite(t)) return { state: 'none' };
  if (isStale((now - t) / 1000)) return { state: 'stale', at };
  if (!(r.pulse > 0)) return { state: 'none' };
  return { state: 'fresh', bpm: roundPulse(r.pulse), at };
}

/* --------------------------------------------------------------- daydream */

export type Daydream =
  /** The live poll has not answered: say what the schedule is, not what it is doing. */
  | { state: 'unknown'; cadence: number }
  | { state: 'next'; minutes: number }
  /** The countdown has run out within the last cadence: the think is due or under way. */
  | { state: 'now' }
  /**
   * Due longer ago than a whole cadence. The loop writes its next time only
   * after a run, so a stopped engine leaves it in the past for good; past one
   * cadence the hero says it is late rather than claim it is thinking.
   */
  | { state: 'late'; minutes: number }
  /** Outside its active hours: it starts again at `wakes` ("07:00"). */
  | { state: 'asleep'; wakes: string }
  /** Inside its hours but not scheduled: switched off, or never set up here. */
  | { state: 'off' };

/** The hour in London as a fraction (14.5 = 14:30), where the site keeps its day. */
export function londonHour(now: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: HEALTH_TIMEZONE,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (get('hour') % 24) + get('minute') / 60;
}

export const clock = (h: number) => `${String(h).padStart(2, '0')}:00`;

export function readDaydream(
  v: Pick<LandingVitals, 'daydream'> | null,
  facts: CapabilityFacts['daydream'],
  now: number,
): Daydream {
  if (!v) return { state: 'unknown', cadence: facts.cadenceMinutes };
  const h = londonHour(now);
  const { start, end } = facts.activeHours;
  if (h < start || h >= end) return { state: 'asleep', wakes: clock(start) };
  const dd = v.daydream;
  if (!dd || dd.paused) return { state: 'off' };
  const due = dd.nextRunAt ? Date.parse(dd.nextRunAt) : NaN;
  if (!Number.isFinite(due)) return { state: 'off' };
  const secs = (due - now) / 1000;
  if (secs >= 60) return { state: 'next', minutes: Math.round(secs / 60) };
  if (secs > -facts.cadenceMinutes * 60) return { state: 'now' };
  return { state: 'late', minutes: Math.round(-secs / 60) };
}

/* ------------------------------------------------------------------ words */

const SMALL = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** Counts in words up to ten, numerals after: "two", "eleven" → "11". */
export function countWord(n: number): string {
  return n >= 0 && n <= 10 ? SMALL[n] : n.toLocaleString('en-GB');
}

/** "once", "twice", "three times", "14 times". */
export function timesWord(n: number): string {
  if (n === 1) return 'once';
  if (n === 2) return 'twice';
  return `${countWord(n)} times`;
}

/** How long ago, as a span: "a minute", "11 minutes", "an hour", "3 hours", "2 days". Null under a minute. */
export function ageWords(iso: string, now: number): string | null {
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(mins) || mins < 1) return null;
  if (mins === 1) return 'a minute';
  if (mins < 60) return `${mins} minutes`;
  const hrs = Math.round(mins / 60);
  if (hrs === 1) return 'an hour';
  if (hrs < 48) return `${hrs} hours`;
  return `${Math.round(hrs / 24)} days`;
}

/** "a moment ago", "a minute ago", "11 minutes ago", "an hour ago", "3 hours ago". */
export function agoWords(iso: string, now: number): string {
  const age = ageWords(iso, now);
  return age ? `${age} ago` : 'a moment ago';
}

/** "a minute", "40 minutes", "an hour", "3 hours". */
export function spanWords(minutes: number): string {
  if (minutes <= 1) return 'a minute';
  if (minutes < 60) return `${minutes} minutes`;
  const hrs = Math.round(minutes / 60);
  return hrs === 1 ? 'an hour' : `${hrs} hours`;
}

/** "March", or "March 2025" when the record began in another year. */
export function sinceWords(iso: string | null, now: number): string | null {
  if (!iso || !Number.isFinite(Date.parse(iso))) return null;
  const d = new Date(iso);
  const month = d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  return d.getUTCFullYear() === new Date(now).getUTCFullYear() ? month : `${month} ${d.getUTCFullYear()}`;
}

/* --------------------------------------------------------------- sentence */

export interface SentenceInput {
  now: number;
  /** Air temperature in °C where the readings come from, or null until the weather is in. */
  temp: number | null;
  pulse: Pulse;
  /** Steps since midnight; null when none have arrived today (not the same as zero). */
  steps: number | null;
  daydream: Daydream;
  /** Deploys today and yesterday (UTC days, as the release record keeps them), or null with no record. */
  deploys: { today: number; yesterday: number } | null;
  /** All releases on record and when the record began, or null with no record. */
  releases: { total: number; since: string | null } | null;
}

function pulseClause(p: Pulse, now: number): Clause {
  const lead = ' My heart is keeping time at ';
  if (p.state === 'fresh')
    return { id: 'pulse', lead, word: String(p.bpm), tail: ' beats a minute', aside: `the watch checked in ${agoWords(p.at, now)}`, end: ',' };
  // Stale says so without saying for how long: a precise "nothing for three
  // days" on the front page would tell anyone how long the watch has been off.
  const aside = p.state === 'stale' ? 'nothing fresh from the watch' : 'waiting on the watch';
  return { id: 'pulse', lead, word: '—', spoken: 'no fresh reading', tail: ' beats a minute', aside, end: ',' };
}

function stepsClause(steps: number | null): Clause {
  if (steps == null) return { id: 'steps', lead: ' the phone hasn’t sent any steps ', word: 'yet today', tail: '', end: ',' };
  const word = `${steps.toLocaleString('en-GB')} step${steps === 1 ? '' : 's'}`;
  return { id: 'steps', lead: ' I’ve walked ', word, tail: ' since midnight', end: ',' };
}

function daydreamClause(d: Daydream): Clause {
  switch (d.state) {
    case 'next':
      return { id: 'daydream', lead: ' and the site will daydream again in ', word: spanWords(d.minutes), tail: '', end: '.' };
    case 'now':
      return { id: 'daydream', lead: ' and the site is ', word: 'thinking now', tail: '', end: '.' };
    case 'late':
      return { id: 'daydream', lead: ' and the site’s daydreamer is ', word: 'running late', tail: '', aside: `it was due ${spanWords(d.minutes)} ago`, end: '.' };
    case 'asleep':
      return { id: 'daydream', lead: ' and the site’s daydreamer is ', word: 'asleep', tail: ` till ${d.wakes}`, aside: 'the loop, not me', end: '.' };
    case 'off':
      return { id: 'daydream', lead: ' and the site’s daydreamer is ', word: 'switched off', tail: ' for now', end: '.' };
    case 'unknown':
      return { id: 'daydream', lead: ' and the site daydreams ', word: `every ${spanWords(d.cadence)}`, tail: '', end: '.' };
  }
}

function shipClause(today: number, yesterday: number, last: boolean): Clause {
  const before = yesterday === 0 ? 'after a quiet yesterday' : `after ${countWord(yesterday)} yesterday`;
  return {
    id: 'ship',
    lead: ' It has shipped ',
    word: today === 0 ? 'nothing yet' : timesWord(today),
    tail: ` today, ${before}`,
    end: last ? '.' : ',',
  };
}

/** The whole sentence for one moment. */
export function buildSentence(s: SentenceInput): Sentence {
  const t = s.temp == null || !Number.isFinite(s.temp) ? null : Math.round(s.temp);
  // A true minus sign, and no "-0".
  const opening = t == null ? '' : `It’s ${t < 0 ? `−${-t}` : t}° out.`;

  const clauses: Clause[] = [pulseClause(s.pulse, s.now), stepsClause(s.steps), daydreamClause(s.daydream)];
  const since = s.releases ? sinceWords(s.releases.since, s.now) : null;
  const releases = s.releases && s.releases.total > 0 ? s.releases : null;
  if (s.deploys) clauses.push(shipClause(s.deploys.today, s.deploys.yesterday, !releases));
  if (releases)
    clauses.push({
      id: 'releases',
      lead: s.deploys ? ' and has released itself ' : ' It has released itself ',
      word: timesWord(releases.total),
      tail: since ? ` since ${since}` : ' in all',
      end: '.',
    });

  const closing = !s.deploys && !releases ? ' Its release record isn’t answering just now.' : '';
  return { opening, clauses, closing };
}

/** The footnote number a value word carries. */
export const noteNumber = (id: NoteId) => NOTES.indexOf(id) + 1;
