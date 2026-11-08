// notes.ts — the hero's "notes" view in words: what each inked mark says, the
// aside pencilled beside it, the explanation behind it, and the fair copy that
// types the whole sheet up.
//
// The same readings and the same honest states as the sentence (sentence.ts):
// a dash until a number is real, a stale pulse that never says for how long,
// steps that are "none yet" rather than zero, the daydreamer's own asleep,
// thinking-now and off. Only the voice changes: the asides are marginalia, so
// they are lower case, short and dry, and never shout.
//
// Pure, like sentence.ts: no DOM and no clock of its own. notes.test.ts pins
// every state.

import type { CapabilityFacts } from './capabilities';
import { dayName, type DayCount, type ShipStats } from './rhythm';
import { agoWords, clock, countWord, sinceWords, spanWords, type Daydream, type NoteId, type Pulse } from './sentence';
import { BPM_MAX, BPM_MIN } from './traces';

/** One reading as the sheet writes it: the value, its label and the aside beside it. */
export interface Reading {
  /** The value as inked: "52", "3,761", or a dash until it is real. */
  value: string;
  /** Said instead of `value` by a screen reader when the value is only a dash. */
  spoken?: string;
  /** The label set beside the value: "bpm", "steps", "deploys today". */
  unit: string;
  /** The pencilled aside. */
  aside: string;
}

const n = (x: number) => x.toLocaleString('en-GB');

export function pulseReading(p: Pulse, now: number): Reading {
  if (p.state === 'fresh') return { value: String(p.bpm), unit: 'bpm', aside: `apple watch, ${agoWords(p.at, now)}` };
  // Stale says so without saying for how long, as the sentence does: a precise
  // age on the front page would tell anyone how long the watch has been off.
  return {
    value: '—',
    spoken: 'no fresh reading',
    unit: 'bpm',
    aside: p.state === 'stale' ? 'nothing fresh from the watch' : 'waiting on the watch',
  };
}

/** Steps since midnight; null is "none have arrived", which is not zero. */
export function stepsReading(total: number | null): Reading {
  if (total == null) return { value: '—', spoken: 'none yet', unit: 'steps', aside: 'the phone hasn’t sent any yet.' };
  return { value: n(total), unit: total === 1 ? 'step' : 'steps', aside: 'so far. it’s a ruler, not a race.' };
}

/** Deploys today, with yesterday in the aside. `days` empty means the record is unavailable. */
export function shipReading(days: DayCount[]): Reading {
  if (!days.length) return { value: '—', spoken: 'no record', unit: 'deploys today', aside: 'the record isn’t answering just now.' };
  const today = days[days.length - 1].count;
  const yesterday = days.length > 1 ? days[days.length - 2].count : 0;
  // The figure is inked beside it; the aside need not say it again.
  const so = today === 0 ? 'none yet.' : 'so far.';
  const before = yesterday === 0 ? 'a quiet yesterday.' : `${countWord(yesterday)} yesterday.`;
  return { value: n(today), unit: today === 1 ? 'deploy today' : 'deploys today', aside: `${so} ${before}` };
}

export interface ReleasesReading extends Reading {
  /** "since March", "since March 2025", or "in all" without a first deploy. */
  since: string;
  /** "204 days", or null with nothing to count. */
  span: string | null;
}

/** Every release on record; null or zero means the record is unavailable. */
export function releasesReading(r: { total: number; firstDeploy: string | null; days: number } | null, now: number): ReleasesReading {
  if (!r || !(r.total > 0))
    return { value: '—', spoken: 'unavailable', unit: 'releases', aside: 'the record isn’t answering just now.', since: '', span: null };
  const since = sinceWords(r.firstDeploy, now);
  return {
    value: n(r.total),
    unit: r.total === 1 ? 'release' : 'releases',
    aside: 'each one written up from its own commits.',
    since: since ? `since ${since}` : 'in all',
    span: r.days > 0 ? `${n(r.days)} day${r.days === 1 ? '' : 's'}` : null,
  };
}

/** What the daydream dial draws. */
export type Dial =
  /** `f` of a turn still to wait, shaded from twelve (a Time Timer); 0 when due. */
  | { kind: 'wait'; f: number }
  | { kind: 'late' }
  | { kind: 'asleep' }
  | { kind: 'off' }
  /** The poll has not answered: the dial is drawn, with nothing claimed on it. */
  | { kind: 'idle' };

export interface DaydreamReading extends Reading {
  /** The pencilled lead-in before the value: "next think in". */
  lead: string;
  dial: Dial;
}

export function daydreamReading(d: Daydream, facts: CapabilityFacts['daydream']): DaydreamReading {
  const { start, end } = facts.activeHours;
  const unit = 'daydream';
  switch (d.state) {
    case 'next':
      return {
        lead: 'next think in',
        value: spanWords(d.minutes),
        unit,
        aside: `sleeps ${clock(end)}–${clock(start)}. the loop, not me.`,
        dial: { kind: 'wait', f: Math.min(1, d.minutes / Math.max(1, facts.cadenceMinutes)) },
      };
    case 'now':
      return { lead: 'the site is', value: 'thinking now', unit, aside: 'one narrow question at a time.', dial: { kind: 'wait', f: 0 } };
    case 'late':
      return { lead: 'the daydreamer is', value: 'running late', unit, aside: `it was due ${spanWords(d.minutes)} ago.`, dial: { kind: 'late' } };
    case 'asleep':
      return { lead: 'the daydreamer is', value: 'asleep', unit, aside: `till ${d.wakes}. the loop, not me.`, dial: { kind: 'asleep' } };
    case 'off':
      return { lead: 'the daydreamer is', value: 'switched off', unit, aside: 'for now.', dial: { kind: 'off' } };
    case 'unknown':
      return {
        lead: 'the site daydreams',
        value: `every ${spanWords(d.cadence)}`,
        unit,
        aside: `between ${clock(start)} and ${clock(end)}.`,
        dial: { kind: 'idle' },
      };
  }
}

/** The stamp's second line: "Darlington · 12°", either half alone, or null with neither. */
export function stampPlace(town: string | undefined, temp: number | null): string | null {
  const t = temp == null || !Number.isFinite(temp) ? null : Math.round(temp);
  // A true minus sign, and no "-0".
  const deg = t == null ? null : `${t < 0 ? `−${-t}` : t}°`;
  return [town || null, deg].filter(Boolean).join(' · ') || null;
}

/* ----------------------------------------------------------------- the wall */

export interface WallDay {
  /** Index into the days, 0 = the oldest. */
  i: number;
  date: string;
  count: number;
}

/** 0 Monday … 6 Sunday, for a YYYY-MM-DD calendar day. */
const mondayFirst = (key: string) => (new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7;

/**
 * The days on the wall a week to a line, Monday first, so a quiet weekend
 * reads as one. Slots before the first day and after today are null.
 */
export function wallWeeks(days: DayCount[]): Array<Array<WallDay | null>> {
  if (!days.length) return [];
  const slots: Array<WallDay | null> = new Array(mondayFirst(days[0].date)).fill(null);
  days.forEach((d, i) => slots.push({ i, date: d.date, count: d.count }));
  while (slots.length % 7) slots.push(null);
  return Array.from({ length: slots.length / 7 }, (_, w) => slots.slice(w * 7, w * 7 + 7));
}

/* ------------------------------------------------------------ explanations */

export interface Plate {
  /** Read on focus, so a label explains itself before it is opened. */
  hint: string;
  head: string;
  text: string;
  href: string;
  cta: string;
}

export interface PlateInput {
  pulse: Pulse;
  /** The rate the line draws (clampBpm of a fresh reading), or null. */
  drawn: number | null;
  now: number;
  facts: CapabilityFacts['daydream'];
  days: DayCount[];
  stats: ShipStats;
  releases: { total: number; days: number } | null;
  /** What the daydream dial draws, so its note describes only what is on it. */
  dial: Dial;
}

/** The daydream note's last line: what the dial shows in this state, or nothing to say. */
function dialWords(d: Dial): string {
  switch (d.kind) {
    case 'wait':
      return d.f > 0 ? ' The shading is the wait till the next one.' : ' Nothing is shaded while it thinks.';
    case 'late':
      return ' A dashed dial means the next is overdue.';
    case 'asleep':
      return ' The z’s mean it is outside its hours.';
    case 'off':
      return ' The dial is struck through while it is off.';
    case 'idle':
      return '';
  }
}

/**
 * What each mark means and where it leads: the sentence's footnotes, told of
 * the inked marks instead of the words. Links go to the public record of each
 * reading and nowhere else.
 */
export function plates(s: PlateInput): Record<NoteId, Plate> {
  const dd = s.facts;
  const hours = `${clock(dd.activeHours.start)}–${clock(dd.activeHours.end)}`;
  const hit = dd.hitRate == null ? null : Math.round(dd.hitRate * 100);
  const bpm = s.pulse.state === 'fresh' ? s.pulse.bpm : null;
  const exact = bpm != null && s.drawn === bpm;
  const busiest = s.stats.busiest;
  const shown = s.days.length;
  return {
    pulse: {
      hint: 'Heart rate, from the Apple Watch.',
      head: `Pulse · Apple Watch · ${s.pulse.state === 'fresh' ? `read ${agoWords(s.pulse.at, s.now)}` : 'no fresh reading'}`,
      text:
        'My heart rate as the Apple Watch last read it, sent up by the phone. ' +
        (bpm == null
          ? 'With no fresh reading the inked line lies flat rather than make one up.'
          : exact
            ? 'The inked line beats at exactly that rate, and so does the ring round the number.'
            : `The inked line draws ${BPM_MIN} to ${BPM_MAX} a minute, so it beats at ${s.drawn}, the nearest it can.`),
      href: '/health',
      cta: 'Health record',
    },
    steps: {
      hint: 'Steps since midnight, from the phone.',
      head: 'Steps · 00:00 → 23:59 · a quarter-hour per stroke',
      text: 'Today on foot, a stroke for each quarter-hour with steps, midnight at the left end. Nothing is drawn after now; the hatched end is the rest of the day.',
      href: '/health',
      cta: 'Health record',
    },
    daydream: {
      hint: 'When the site next thinks to itself.',
      head: `Daydream · every ${dd.cadenceMinutes} min · ${hours}`,
      text:
        // The hours are in the head; the text is kept to two lines on a wide sheet.
        'The site asks itself one narrow question at a time and keeps only what is worth attention.' +
        (hit != null ? ` ${hit}% of rated notes were useful in the last ${dd.windowDays} days.` : '') +
        dialWords(s.dial),
      href: '/projects/engine-room/daydream',
      cta: 'How it works',
    },
    ship: shown
      ? {
          hint: 'Deploys today, and a stroke for every deploy of the last forty days.',
          head: `Ship · ${s.days[shown - 1].count} today · ${shown > 1 ? s.days[shown - 2].count : 0} yesterday · last ${shown} days`,
          text:
            'One stroke per deploy, a gate for every five, a week to a line and today ringed. ' +
            (busiest
              ? `${n(s.stats.total)} in ${shown} days, the busiest ${busiest.count} on ${dayName(busiest.date)}, and ${s.stats.quiet} days with none.`
              : `Nothing in ${shown} days.`),
          href: '/releases',
          cta: 'Browse the record',
        }
      : {
          hint: 'Deploys today.',
          head: 'Ship · the record isn’t answering',
          text: 'The release record isn’t answering just now, so the wall is left blank rather than tallied with zeros.',
          href: '/releases',
          cta: 'Browse the record',
        },
    releases: {
      hint: 'Every release on record.',
      head: s.releases ? `Releases · ${n(s.releases.total)} over ${n(s.releases.days)} days` : 'Releases · the record isn’t answering',
      text: s.releases
        ? 'Every release since the first deploy, each one summarised from its own commit range.'
        : 'The release record isn’t answering just now, so there is no total to pin up.',
      href: '/releases',
      cta: 'Browse the record',
    },
  };
}

/* ---------------------------------------------------------- the fair copy */

export interface FairRow {
  id: NoteId | 'date';
  term: string;
  value: string;
  note: string;
}

export interface FairInput {
  date: string;
  place: string | null;
  pulse: Pulse;
  now: number;
  steps: number | null;
  daydream: DaydreamReading;
  facts: CapabilityFacts['daydream'];
  days: DayCount[];
  stats: ShipStats;
  releases: ReleasesReading;
}

/** The sheet typed up: every reading in words, for the fair-copy list and for print. */
export function fairCopy(s: FairInput): FairRow[] {
  const p = s.pulse;
  const dd = s.facts;
  const shown = s.days.length;
  const today = shown ? s.days[shown - 1].count : 0;
  const yesterday = shown > 1 ? s.days[shown - 2].count : 0;
  return [
    {
      id: 'pulse',
      term: 'Pulse',
      value: p.state === 'fresh' ? `${p.bpm} bpm` : 'no fresh reading',
      note: p.state === 'fresh' ? `Apple Watch, read ${agoWords(p.at, s.now)}` : p.state === 'stale' ? 'nothing fresh from the Apple Watch' : 'waiting on the Apple Watch',
    },
    {
      id: 'steps',
      term: 'Steps',
      value: s.steps == null ? 'none yet' : n(s.steps),
      note: s.steps == null ? 'the phone hasn’t sent any today' : 'since midnight',
    },
    {
      id: 'daydream',
      term: 'Daydream',
      value: `${s.daydream.lead} ${s.daydream.value}`,
      note: `every ${spanWords(dd.cadenceMinutes)}, ${clock(dd.activeHours.start)}–${clock(dd.activeHours.end)}`,
    },
    {
      id: 'ship',
      term: 'Deploys',
      value: shown ? `${today} today` : 'unavailable',
      note: shown ? `${yesterday} yesterday · ${n(s.stats.total)} in the last ${shown} days` : 'the release record isn’t answering',
    },
    {
      id: 'releases',
      term: 'Releases',
      value: s.releases.spoken ? 'unavailable' : s.releases.value,
      note: s.releases.spoken ? 'the release record isn’t answering' : [s.releases.since, s.releases.span].filter(Boolean).join(' · '),
    },
    { id: 'date', term: 'Today', value: s.date, note: s.place ?? '' },
  ];
}
