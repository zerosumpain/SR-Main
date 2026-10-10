// showcase-sentence.ts — the sentence view's showcase, as words and geometry.
//
// Below the hero the sentence carries on as a long-form feature: four
// chapters (Daydream, the health record, the app, the builder) and a closing
// line, each written as first-person prose in which every live figure is a
// value word with a numbered footnote, exactly as the hero's sentence does.
// The footnote numbers carry on from the hero's, so the page reads as one
// essay.
//
// Everything here is pure: data in, segments and small chart geometry out, so
// the server and the browser lay out the same text and the honest empty
// states (a dash, a missing clause, "isn't answering") are unit tests.
//
// Copy rules this file keeps (tested in showcase-sentence.test.ts):
//   - no digit is ever written into the copy; every figure comes from data;
//   - en-GB grouping, the real minus sign, no "!" and no colons in prose;
//   - counts, totals, ratios and bands only, and nothing that reveals absence
//     (a stale pulse is simply not mentioned).

import { thinkSchedule, shipDays, dayName, type Think } from './rhythm';
import { NOTES, clock, countWord, readDaydream, spanWords, agoWords, type Daydream } from './sentence';
import { formatFigure } from './showcase-motion';
import type { ShowcaseProps } from './showcase';
import type { StepsToday } from './steps';
import { localToday } from '$lib/constants/health-day';

/* ------------------------------------------------------------- the shapes */

/** Orange (pulse, steps, ship) or petrol (daydream, releases), as in the hero. */
export type Tone = 'accent' | 'ink';
export type Band = 'low' | 'mid' | 'high';

export interface VerdictColumn {
  start: string;
  useful: number;
  notUseful: number;
  undecided: number;
  /** Heights as shares of the busiest week, stacked from the foot. */
  hUseful: number;
  hNotUseful: number;
  hUndecided: number;
}

export interface HourBar {
  hour: number;
  steps: number;
  /** 0..1 of the busiest hour so far. */
  h: number;
  state: 'past' | 'now' | 'future';
}

export interface DayCell {
  /** Its place in the window, oldest first. */
  i: number;
  /** Null when nothing was sent that day (a dash, never a zero). */
  steps: number | null;
  /** Thousands, as the row prints them. */
  k: string;
  over: boolean;
  /** Opacity, kept at or above the 4.5:1 floor on paper. */
  a: number;
}

export interface DeployCell {
  date: string;
  count: number;
  a: number;
  today: boolean;
}

/** The small exact picture a footnote carries. */
export type Visual =
  | { kind: 'none' }
  | { kind: 'slots'; thinks: Think[]; off: boolean; summary: string }
  | { kind: 'verdicts'; cols: VerdictColumn[]; summary: string }
  | { kind: 'hours'; bars: HourBar[]; summary: string }
  | { kind: 'days'; cells: DayCell[]; summary: string }
  | { kind: 'bands'; marks: Band[]; summary: string }
  | { kind: 'deploys'; cells: DeployCell[]; summary: string }
  | { kind: 'quotes'; lines: string[] }
  | { kind: 'list'; items: string[] }
  | { kind: 'lives'; rows: { label: string; share: number; open: boolean }[]; more: number; summary: string };

export interface Note {
  head: string;
  text: string;
  href?: string;
  cta?: string;
  visual: Visual;
}

export type Seg =
  | { t: 'text'; s: string }
  | {
      t: 'word';
      id: string;
      word: string;
      /** Read instead of `word` (a dash's spoken alternative). */
      spoken?: string;
      tone: Tone;
      /** A footnote opens from the word; its number is set by numberNotes. */
      note?: Note;
      n?: number;
      /** A link instead of a footnote (the closing line). */
      href?: string;
    };

export interface SideLine {
  text: string;
  /** A live reading (gets the small dot); otherwise a fixed fact. */
  live?: boolean;
}

/** The one small exact chart a chapter sets in its margin, always in view. */
export interface Marginal {
  label: string;
  visual: Visual;
}

export interface ChapterCopy {
  id: 'daydream' | 'health' | 'app' | 'build' | 'wildmind';
  /** Its place in the essay, from one (a screen reader hears "Chapter three"). */
  nth: number;
  numeral: string;
  label: string;
  head: string;
  tone: Tone;
  ground: 'paper' | 'ink';
  figure: { value: number | null; decimals: number; unit: string; spoken: string };
  side: SideLine[];
  /** The margin's chart (the footnote carries the long version), or null. */
  margin: Marginal | null;
  p1: Seg[];
  /** The second movement, under a small mono subhead; null when there's nothing to say. */
  p2: { sub: string; segs: Seg[] } | null;
  /** The way on; Wildmind has none. */
  link?: { href: string; text: string };
}

/* ---------------------------------------------------------------- figures */

/** A figure as the showcase prints it (en-GB, real minus, fixed decimals). */
export const fig = (n: number, decimals = 0) => formatFigure(n, decimals);

/** "73%" from 0.73; the share is rounded to a whole percent. */
export const pct = (r: number) => `${formatFigure(Math.round(r * 100))}%`;

/** "1 step", "2 steps": a plural on a figure. */
export const plural = (n: number, one: string, many = `${one}s`) => `${fig(n)} ${n === 1 ? one : many}`;

/** "eight tabs", "14 tabs": a count in words up to ten. */
export const counted = (n: number, one: string, many = `${one}s`) => `${countWord(n)} ${n === 1 ? one : many}`;

/** "One", "Twelve" → numerals past ten, first letter up. */
export const capWord = (n: number) => {
  const w = countWord(n);
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/** The dash a missing figure shows, and what a screen reader hears instead. */
export const DASH = '—';
export const NOT_ANSWERING = 'not answering just now';

/** The day mark steps are judged against, set once here rather than in the copy. */
export const STEP_GOAL = 10_000;
/** The recovery window the record counts over (HealthShowcase.recovery30). */
export const RECOVERY_DAYS = 30;
/** Days of deploys the build footnote shows, as the hero's ship row does. */
export const DEPLOY_DAYS = 40;
/** The hero's footnotes run 1..5; the showcase carries on from there. */
export const FIRST_NOTE = NOTES.length + 1;

/**
 * How wide a figure sets, in ems of Inter 800 with tabular digits, so the
 * stylesheet can cap its size to the column (`100cqi / width`) and a long
 * figure never overflows a phone. Digits ~0.64em, separators ~0.3em.
 */
export function figureEms(text: string): number {
  let w = 0;
  for (const ch of text) w += /\d/.test(ch) ? 0.64 : ch === ',' || ch === '.' ? 0.3 : ch === '%' ? 0.9 : ch === '—' ? 1 : 0.6;
  return Math.max(1.6, Math.round(w * 100) / 100);
}

/** Recovery and sleep bands in plain words. */
export function bandWord(b: Band): string {
  return b === 'high' ? 'good' : b === 'mid' ? 'middling' : 'low';
}

/** "12 October 2026" for an ISO timestamp, or null. */
export function longDate(iso: string | null): string | null {
  if (!iso || !Number.isFinite(Date.parse(iso))) return null;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
}

/** "Monday 15 June" for a day key, as prose names a date. */
export function longDay(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).replace(',', '');
}

/** A widget as the app's list names it; a Live Activity is called just that. */
export function widgetName(w: { name: string; surface: string }): string {
  return w.surface === 'live-activity' ? 'Live Activity' : w.name;
}

/* --------------------------------------------------------------- geometry */

/**
 * Twelve weeks of verdicts as stacked columns: useful at the foot, not useful
 * above it, undecided on top. Heights are shares of the busiest week, so the
 * tallest column fills the box.
 */
export function verdictColumns(weeks: { start: string; useful: number; notUseful: number; undecided: number }[]): VerdictColumn[] {
  const n = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0);
  const peak = Math.max(1, ...weeks.map((w) => n(w.useful) + n(w.notUseful) + n(w.undecided)));
  const r = (x: number) => Math.round((x / peak) * 1000) / 1000;
  return weeks.map((w) => ({
    start: w.start,
    useful: n(w.useful),
    notUseful: n(w.notUseful),
    undecided: n(w.undecided),
    hUseful: r(n(w.useful)),
    hNotUseful: r(n(w.notUseful)),
    hUndecided: r(n(w.undecided)),
  }));
}

export function verdictSummary(cols: VerdictColumn[]): string {
  if (!cols.length) return 'No verdicts on record yet.';
  const sum = (k: 'useful' | 'notUseful' | 'undecided') => cols.reduce((a, c) => a + c[k], 0);
  return `Over ${countWord(cols.length)} weeks, ${plural(sum('useful'), 'note')} marked useful, ${fig(sum('notUseful'))} not useful and ${fig(sum('undecided'))} still undecided.`;
}

/**
 * Today's steps an hour to a bar. The record arrives hourly but is binned in
 * quarter-hours (96 a day), so four bins make an hour. Hours after now are
 * the future and draw nothing.
 */
export function hourBars(s: StepsToday | null): HourBar[] {
  const per = Math.max(1, Math.round((s?.bins.length || 96) / 24));
  const nowHour = s ? Math.min(23, Math.floor(s.nowBin / per)) : -1;
  const hours = Array.from({ length: 24 }, (_, h) => {
    let v = 0;
    if (s) for (let i = h * per; i < (h + 1) * per && i < s.bins.length; i++) if (i <= s.nowBin && s.bins[i] > 0) v += s.bins[i];
    return v;
  });
  const peak = Math.max(1, ...hours.slice(0, nowHour + 1));
  return hours.map((v, hour) => ({
    hour,
    steps: hour > nowHour ? 0 : v,
    h: hour > nowHour ? 0 : Math.round((v / peak) * 1000) / 1000,
    state: hour > nowHour ? 'future' : hour === nowHour ? 'now' : 'past',
  }));
}

export function hoursSummary(s: StepsToday | null, bars: HourBar[]): string {
  if (!s || s.total == null) return 'No steps have come in today, so every hour is empty.';
  const walked = bars.filter((b) => b.state !== 'future' && b.steps > 0).length;
  const gone = bars.filter((b) => b.state !== 'future').length;
  return `${plural(s.total, 'step')} so far today, with some walking in ${countWord(walked)} of the ${countWord(gone)} hours since midnight.`;
}

/**
 * The thirty days of steps ending on the latest complete day with readings,
 * oldest first: a day the phone sent nothing for is a dash, never a zero.
 */
export function dayCells(steps30: Array<number | null> | null): DayCell[] {
  if (!steps30?.length) return [];
  const peak = Math.max(1, ...steps30.map((v) => (v != null && Number.isFinite(v) ? v : 0)));
  return steps30.map((v, i) => {
    const steps = v == null || !Number.isFinite(v) ? null : v;
    return {
      i,
      steps,
      k: steps == null ? '–' : fig(Math.round(steps / 1000)),
      over: steps != null && steps >= STEP_GOAL,
      a: steps == null ? 0.68 : Math.round((0.68 + 0.32 * Math.min(1, steps / peak)) * 100) / 100,
    };
  });
}

export function daysSummary(cells: DayCell[]): string {
  const real = cells.filter((c) => c.steps != null) as (DayCell & { steps: number })[];
  if (!real.length) return 'No days of steps on record.';
  const lo = Math.min(...real.map((c) => c.steps));
  const hi = Math.max(...real.map((c) => c.steps));
  const over = real.filter((c) => c.over).length;
  return `The last ${countWord(cells.length)} days with readings ran from ${fig(lo)} to ${fig(hi)} steps, ${countWord(over)} of them at or over ${fig(STEP_GOAL)}.`;
}

/** Recovery days as marks, best first: a count by band, not a diary. */
export function bandMarks(r: { high: number; mid: number; low: number } | null): Band[] {
  if (!r) return [];
  const n = (x: number) => (Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);
  return [
    ...Array<Band>(n(r.high)).fill('high'),
    ...Array<Band>(n(r.mid)).fill('mid'),
    ...Array<Band>(n(r.low)).fill('low'),
  ];
}

export function bandsSummary(r: { high: number; mid: number; low: number } | null): string {
  if (!r) return 'No recovery on record.';
  return `${capWord(r.high)} good, ${countWord(r.mid)} middling and ${countWord(r.low)} low, sorted by band rather than by date.`;
}

/** Forty days of deploys as a numeral row, as the hero's ship row draws them. */
export function deployCells(cadence: { date: string; count: number }[], todayKey: string, n = DEPLOY_DAYS): DeployCell[] {
  if (!cadence.length) return [];
  const days = shipDays(cadence, todayKey, n);
  const peak = Math.max(1, ...days.map((d) => d.count));
  return days.map((d, i) => ({
    date: d.date,
    count: d.count,
    a: Math.round((0.72 + 0.28 * (d.count / peak)) * 100) / 100,
    today: i === days.length - 1,
  }));
}

export function deploysSummary(cells: DeployCell[]): string {
  if (!cells.length) return 'No deploys on record.';
  const total = cells.reduce((a, c) => a + c.count, 0);
  let busiest: DeployCell | null = null;
  for (const c of cells) if (c.count > 0 && (!busiest || c.count >= busiest.count)) busiest = c;
  const quiet = cells.filter((c) => c.count === 0).length;
  return busiest
    ? `${plural(total, 'deploy')} in the last ${countWord(cells.length)} days, the busiest ${fig(busiest.count)} on ${dayName(busiest.date)}, and ${countWord(quiet)} quiet days.`
    : `No deploys in the last ${countWord(cells.length)} days.`;
}

/* ------------------------------------------------------------ live states */

/** The daydreamer right now, as a margin line. */
export function daydreamSide(d: Daydream): SideLine {
  switch (d.state) {
    case 'next':
      return { text: `next think in ${spanWords(d.minutes)}`, live: true };
    case 'now':
      return { text: 'thinking now', live: true };
    case 'late':
      return { text: 'running a little late' };
    case 'asleep':
      return { text: `asleep till ${d.wakes}` };
    case 'off':
      return { text: 'switched off for now' };
    case 'unknown':
      return { text: `a think every ${spanWords(d.cadence)}` };
  }
}

/** The builder right now, or nothing until the poll answers. */
export function builderSide(v: ShowcaseProps['v']): SideLine | null {
  if (!v) return null;
  const stage = v.builder.stage?.trim().toLowerCase();
  if (v.builder.active) return { text: stage && stage !== 'idle' ? `building now · ${stage}` : 'building now', live: true };
  return { text: 'the builder is idle' };
}

/* ------------------------------------------------------------------- copy */

const T = (s: string): Seg => ({ t: 'text', s });
const W = (id: string, word: string, tone: Tone, note?: Note): Seg => ({ t: 'word', id, word, tone, note });

/** Joins clauses as prose does: "a, b and c". Each clause is a run of segments. */
export function joinClauses(parts: Seg[][], last = ' and '): Seg[] {
  const out: Seg[] = [];
  parts.forEach((p, i) => {
    if (i > 0) out.push(T(i === parts.length - 1 ? last : ', '));
    out.push(...p);
  });
  return out;
}

type Ctx = ShowcaseProps & { todayKey: string };

export function daydreamChapter(c: Ctx): ChapterCopy {
  const { rules: r, week: w, impact: im } = c.data.daydream;
  const hours = `${clock(r.activeHours.start)}–${clock(r.activeHours.end)}`;
  const live = readDaydream(c.v, c.facts.daydream, c.now);
  const vd = c.v?.daydream;
  const thinks = thinkSchedule(
    c.now,
    r.cadenceMinutes,
    r.activeHours,
    vd && !vd.paused && live.state !== 'late' ? vd.nextRunAt : null,
  );
  const gone = thinks.filter((t) => t.state === 'earlier').length;
  const next = thinks.find((t) => t.state === 'next');

  const p1: Seg[] = [
    T('I taught the site to daydream. Every '),
    W('dd-cadence', spanWords(r.cadenceMinutes), 'ink', {
      head: `Daydream · every ${r.cadenceMinutes} min · ${hours}`,
      text:
        `Each think may make at most ${countWord(r.maxLookups)} look-ups and write at most ${countWord(r.maxNotes)} notes, ` +
        `and no more than ${countWord(r.dailyRaiseCap)} a day are raised to me, so it can’t nag.`,
      href: '/projects/engine-room/daydream',
      cta: 'How Daydream works',
      visual: {
        kind: 'slots',
        thinks,
        off: live.state === 'off',
        summary:
          `${capWord(gone)} of today’s ${countWord(thinks.length)} slots gone by` +
          (next && live.state !== 'off' ? `, the next at ${next.at}.` : '.'),
      },
    }),
    T(
      ` between ${clock(r.activeHours.start)} and ${clock(r.activeHours.end)} it picks one corner of my life, asks itself one narrow question about it, ` +
        'goes off and looks things up, and writes down only what it thinks I ought to see.',
    ),
  ];
  if (w) {
    p1.push(
      T(' This week that came to '),
      W('dd-hours', `${fig(w.hours, 1)} hour${w.hours === 1 ? '' : 's'}`, 'ink', {
        head: 'Thinking · the last seven days',
        text: 'Wall-clock time spent thinking over the last seven days, one question at a time.',
        visual: { kind: 'none' },
      }),
      T(' of thinking and '),
      W('dd-lookups', plural(w.lookups, 'look-up'), 'ink', {
        head: `Look-ups · at most ${r.maxLookups} a think`,
        text: 'Searches, page reads and sums it made along the way. It reads my own records and the open web through separate doors, and never carries one into the other.',
        visual: { kind: 'none' },
      }),
      T(' across '),
      W('dd-areas', `${w.areasCovered === 0 ? 'none' : countWord(w.areasCovered)} of ${countWord(r.areas)}`, 'ink', {
        head: `Areas of life · ${r.areas} in rotation`,
        text: 'The clock picks the area, not the news, so every part of my life gets its turn whether or not anything is happening in it.',
        visual: { kind: 'none' },
      }),
      T(' areas of life, and its own auditor struck out '),
      W('dd-struck', w.struckOut === 0 ? 'nothing' : plural(w.struckOut, 'claim'), 'ink', {
        head: 'The auditor · this week',
        text: 'A second pass reads every note before it reaches me and strikes out whatever its sources don’t back up, sometimes a whole note and sometimes a single citation.',
        visual: { kind: 'none' },
      }),
      T(w.struckOut === 0 ? '.' : ' it couldn’t stand behind.'),
    );
  } else {
    p1.push(T(' This week’s tally isn’t answering just now.'));
  }

  // The verdicts: how useful it has been, and what came of it.
  const p2: Seg[] = [T('I mark what it tells me as useful or not from my phone')];
  if (!im) {
    p2.push(T(', and how that’s going isn’t answering just now.'));
  } else {
    const cols = verdictColumns(im.weeks);
    if (im.hitRate != null && im.rated > 0) {
      p2.push(
        T(`, and over the last ${r.windowDays} days `),
        W('dd-hit', pct(im.hitRate), 'ink', {
          head: `Verdicts · ${countWord(cols.length)} weeks · ${fig(im.rated)} rated lately`,
          text: 'A week to a column, oldest on the left. Useful sits at the foot in colour, not useful above it, and anything I haven’t got round to is the open box on top.',
          href: '/projects/engine-room/daydream',
          cta: 'How Daydream works',
          visual: { kind: 'verdicts', cols, summary: verdictSummary(cols) },
        }),
        T(` of the ${plural(im.rated, 'note')} I rated were worth having`),
      );
      if (im.previousHitRate != null) {
        const now = Math.round(im.hitRate * 100);
        const before = Math.round(im.previousHitRate * 100);
        p2.push(
          T(now > before ? ', up from ' : now < before ? ', down from ' : ', the same as '),
          { t: 'word', id: 'dd-prev', word: pct(im.previousHitRate), tone: 'ink' },
          T(' the stretch before'),
        );
      }
      p2.push(T('.'));
    } else {
      p2.push(T(`, though nothing has been rated in the last ${r.windowDays} days.`));
    }
    const shippedNote: Note = {
      head: 'From idea to code · all time',
      text: `Ideas it raised that I accepted onto the build list, ${fig(im.accepted)} so far, and the ones the builder has since shipped, ${fig(im.shipped)}.`,
      href: '/projects/engine-room/build',
      cta: 'How it builds',
      visual: { kind: 'none' },
    };
    if (im.shipped > 0) {
      p2.push(
        T(' '),
        W('dd-shipped', capWord(im.shipped), 'ink', shippedNote),
        T(
          im.shipped === 1
            ? ' of its ideas has gone on to become real code on this site, which is a better strike rate than most of mine.'
            : ' of its ideas have gone on to become real code on this site, which is a better strike rate than most of mine.',
        ),
      );
    } else if (im.accepted > 0) {
      p2.push(T(' None of its ideas has become code yet, though '), W('dd-shipped', countWord(im.accepted), 'ink', shippedNote), T(' are on the build list.'));
    } else {
      p2.push(T(' None of its ideas has become code yet.'));
    }
  }

  const verdicts = im && im.weeks.length ? verdictColumns(im.weeks) : null;
  return {
    id: 'daydream',
    nth: 1,
    numeral: 'i.',
    label: 'Daydream',
    head: 'It thinks while nobody’s watching',
    tone: 'ink',
    ground: 'paper',
    figure: { value: w?.questions ?? null, decimals: 0, unit: 'questions it asked itself this week', spoken: NOT_ANSWERING },
    side: [daydreamSide(live)],
    margin: verdicts ? { label: `Verdicts · ${countWord(verdicts.length)} weeks`, visual: { kind: 'verdicts', cols: verdicts, summary: verdictSummary(verdicts) } } : null,
    p1,
    p2: { sub: 'The verdicts', segs: p2 },
    link: { href: '/projects/engine-room/daydream', text: 'How it thinks' },
  };
}

export function healthChapter(c: Ctx): ChapterCopy {
  const h = c.data.health;
  const cells = dayCells(h.steps30);

  const p1: Seg[] = [T('My watch and phone keep a closer record of me than I’d ever manage by hand, and the site reads it every day.')];
  const year: Seg[][] = [];
  if (h.kmYear != null)
    year.push([
      T('covered '),
      W('h-km', `${fig(h.kmYear, 1)} km`, 'accent', {
        head: 'On foot · since New Year’s Day',
        text: 'Walking and running distance from the phone, everyday pottering included, which is most of it.',
        visual: { kind: 'none' },
      }),
      T(' on foot'),
    ]);
  if (h.daysOver10k != null)
    year.push([
      T(`passed ${fig(STEP_GOAL)} steps on `),
      W('h-goal', plural(h.daysOver10k, 'day'), 'accent', {
        head: `Steps · the last ${countWord(cells.length || RECOVERY_DAYS)} days with readings · thousands`,
        text: `A numeral a day in thousands of steps, oldest on the left and the latest on the right. Days at or over ${fig(STEP_GOAL)} are in colour, and a day the phone sent nothing for is a dash.`,
        href: '/health',
        cta: 'Health record',
        visual: { kind: 'days', cells, summary: daysSummary(cells) },
      }),
    ]);
  if (h.bestDay)
    year.push([
      T('managed '),
      W('h-best', plural(h.bestDay.steps, 'step'), 'accent', {
        head: 'Best day · this year',
        text: `The most steps in one complete day since New Year’s Day, on ${longDay(h.bestDay.date)}. Today can’t take the title until it’s over.`,
        visual: { kind: 'none' },
      }),
      T(` on my best day, back on ${longDay(h.bestDay.date)}`),
    ]);
  if (year.length) p1.push(T(' This year I’ve '), ...joinClauses(year), T('.'));
  else p1.push(T(' This year’s totals aren’t answering just now.'));

  const total = c.steps?.total ?? null;
  if (total != null) {
    const bars = hourBars(c.steps);
    p1.push(
      T(' Today I’m on '),
      W('h-today', plural(total, 'step'), 'accent', {
        head: 'Today · an hour to a bar · midnight to now',
        text: 'Steps by the hour since midnight. Nothing is drawn past the hour we’re in.',
        href: '/health',
        cta: 'Health record',
        visual: { kind: 'hours', bars, summary: hoursSummary(c.steps, bars) },
      }),
      T(' so far.'),
    );
  }
  // No steps yet today: the hero has already said so, and a missing
  // flourish is simply left out.

  // The second movement: heart, recovery and sleep, as bands and averages.
  const p2: Seg[] = [];
  const fresh = c.pulse.state === 'fresh' ? c.pulse.bpm : null;
  // The figure itself is in the margin and on the line; the prose only
  // points at it, rather than saying the hero's sentence again.
  if (fresh != null) p2.push(T('The line above this chapter is my heartbeat, drawn at the rate my watch last read. '));
  const rc = h.recovery30;
  const tail: Seg[][] = [];
  if (h.sleepAvg7 != null)
    tail.push([
      T('I’ve slept '),
      W('h-sleep', `${fig(h.sleepAvg7, 1)} hours`, 'accent', {
        head: 'Sleep · the last seven nights',
        text: 'Average time asleep a night, naps left out. When I went to bed stays off the page.',
        visual: { kind: 'none' },
      }),
      T(' a night on average this past week'),
    ]);
  if (rc) {
    const marks = bandMarks(rc);
    p2.push(
      T(`Over the last ${fig(RECOVERY_DAYS)} days I’ve had `),
      W('h-recovery', plural(rc.high, 'day'), 'accent', {
        head: `Recovery · the last ${fig(RECOVERY_DAYS)} days · by band`,
        text: 'A mark a day, sorted by band rather than by date. Good is solid, middling is half full and low is an empty box.',
        href: '/health',
        cta: 'Health record',
        visual: { kind: 'bands', marks, summary: bandsSummary(rc) },
      }),
      T(' of good recovery, '),
      { t: 'word', id: 'h-mid', word: countWord(rc.mid), tone: 'accent' },
      T(' middling and '),
      { t: 'word', id: 'h-low', word: countWord(rc.low), tone: 'accent' },
      T(' low'),
      ...(tail.length ? [T(', and '), ...tail[0]] : []),
      T('.'),
    );
  } else if (tail.length) {
    p2.push(T('Lately '), ...tail[0], T('.'));
  }
  const bands: Seg[][] = [];
  if (h.bands.sleep) bands.push([T('last night’s sleep was '), { t: 'word', id: 'h-sleepband', word: bandWord(h.bands.sleep), tone: 'accent' }]);
  if (h.bands.recovery)
    bands.push([
      T('today’s recovery reads '),
      W('h-band', bandWord(h.bands.recovery), 'accent', {
        head: 'Bands, not scores',
        text: 'Good, middling or low, as the strap grades them. The exact numbers live on the health page, where there’s room to explain them.',
        href: '/health',
        cta: 'Health record',
        visual: { kind: 'none' },
      }),
    ]);
  if (bands.length) {
    const first = bands[0][0] as { t: 'text'; s: string };
    bands[0] = [T(first.s.charAt(0).toUpperCase() + first.s.slice(1)), ...bands[0].slice(1)];
    p2.push(T(p2.length ? ' ' : ''), ...joinClauses(bands, ' and '), T('.'));
  }
  if (!p2.length) p2.push(T('The rest of the record isn’t answering just now.'));

  return {
    id: 'health',
    nth: 2,
    numeral: 'ii.',
    label: 'Health',
    head: 'My body, on the record',
    tone: 'accent',
    ground: 'paper',
    figure: { value: h.stepsYear, decimals: 0, unit: 'steps so far this year', spoken: NOT_ANSWERING },
    side: fresh != null ? [{ text: `${fig(fresh)} bpm, as my watch last read it`, live: true }] : [],
    margin: rc ? { label: `Recovery · the last ${fig(RECOVERY_DAYS)} days`, visual: { kind: 'bands', marks: bandMarks(rc), summary: bandsSummary(rc) } } : null,
    p1,
    p2: { sub: fresh != null ? 'The pulse, and the rest of me' : 'The rest of me', segs: p2.filter((s) => s.t !== 'text' || s.s !== '') },
    link: { href: '/health', text: 'The whole record' },
  };
}

export function appChapter(c: Ctx): ChapterCopy {
  const a = c.data.app;
  const live = a.widgets.find((w) => w.surface === 'live-activity');
  const readiness = a.complications.some((x) => /readiness/i.test(x.name));
  const surface = (s: string) => (s === 'live-activity' ? 'Lock Screen' : s === 'home-screen' ? 'Home Screen' : s.replace(/-/g, ' '));

  const parts: Seg[][] = [
    [
      W('a-tabs', counted(a.tabs, 'tab'), 'accent', {
        head: 'Tabs · left to right',
        text: `The tab bar as it sits on the phone, and ${countWord(a.watchPages)} pages of it again on the watch.`,
        href: '/projects/engine-room/app',
        cta: 'How the app works',
        visual: { kind: 'list', items: a.tabNames },
      }),
    ],
  ];
  if (a.widgets.length)
    parts.push([
      W('a-widgets', counted(a.widgets.length, 'widget'), 'accent', {
        head: 'Widgets · Home Screen and Lock Screen',
        text: 'The phone draws them and the site decides every word.',
        visual: { kind: 'list', items: a.widgets.map((w) => `${widgetName(w)} · ${surface(w.surface)}`) },
      }),
      ...(live && a.widgets.length > 1 ? [T(', one of them a Live Activity on the Lock Screen')] : live ? [T(', a Live Activity on the Lock Screen')] : []),
    ]);
  if (a.complications.length)
    parts.push([
      W('a-comps', counted(a.complications.length, 'complication'), 'accent', {
        head: 'On the watch face',
        text: 'Small readings on the watch face, drawn from the same record as the site.',
        href: '/health',
        cta: 'Health record',
        visual: { kind: 'list', items: a.complications.map((x) => x.name) },
      }),
      T(' for the watch'),
    ]);
  // A clause with its own aside takes a comma before the "and" that follows it.
  const joined: Seg[] = [];
  parts.forEach((p, i) => {
    if (i > 0) {
      const asideBefore = parts[i - 1].some((s) => s.t === 'text' && s.s.startsWith(', '));
      joined.push(T(i === parts.length - 1 ? (asideBefore ? ', and ' : ' and ') : ', '));
    }
    joined.push(...p);
  });

  const p1: Seg[] = [T('There’s an app too, on my iPhone and my Apple Watch, with '), ...joined, T('.')];
  if (readiness) p1.push(T(' The Readiness one shows the same number as the health page, so my wrist and the website can’t disagree.'));
  if (a.intents.length)
    p1.push(
      T(' I can ask Siri for '),
      W('a-siri', counted(a.intents.length, 'thing'), 'accent', {
        head: 'Siri and the Action button',
        text: 'Said out loud, or set on the Action button, without opening the app.',
        visual: { kind: 'quotes', lines: a.intents.map((i) => i.title) },
      }),
      T(' by name'),
      ...(a.games.length ? [T(', and')] : [T('.')]),
    );
  if (a.games.length)
    p1.push(
      T(a.intents.length ? ' there are ' : ' There are '),
      W('a-games', counted(a.games.length, 'family game'), 'accent', {
        head: 'Family games',
        text: 'Played across the family’s phones. Who won stays in the family.',
        visual: { kind: 'list', items: a.games },
      }),
      T(' for evenings when we really ought to be doing something else.'),
    );

  const p2: Seg[] = [
    T('Pairing a new phone takes a code that dies in '),
    W('a-pair', spanWords(a.pairCodeMinutes), 'accent', {
      head: 'Pairing',
      text: 'The site shows the code once and the phone reads it with its camera. What the phone gets back is a key, and the site keeps only a fingerprint of it, never the key itself.',
      href: '/projects/engine-room/app',
      cta: 'How the app works',
      visual: { kind: 'none' },
    }),
    T(', swapped for a key that lasts '),
    { t: 'word', id: 'a-key', word: `${fig(a.deviceTokenDays)} days`, tone: 'accent' },
    T(
      '. The app is also where the loop closes, because Daydream’s notes land in a little inbox on its More page, and the buttons I tap there are the verdicts in the first chapter.',
    ),
  ];

  return {
    id: 'app',
    nth: 3,
    numeral: 'iii.',
    label: 'The app',
    head: 'It lives in my pocket',
    tone: 'accent',
    ground: 'ink',
    figure: { value: a.nativeEndpoints, decimals: 0, unit: 'doors from my phone into the site', spoken: NOT_ANSWERING },
    side: [{ text: 'iPhone and Apple Watch' }, { text: `${countWord(a.nativeAreas)} areas of the site` }],
    margin: a.intents.length ? { label: 'Things I say to Siri', visual: { kind: 'quotes', lines: a.intents.map((i) => i.title) } } : null,
    p1,
    p2: { sub: 'The doorway', segs: p2 },
    link: { href: '/projects/engine-room/app', text: 'How the app works' },
  };
}

export function buildChapter(c: Ctx): ChapterCopy {
  const b = c.build;
  // The deploy row reads the day counts alone, so it stands even when the
  // release totals are missing.
  const cells = deployCells(c.cadence, c.todayKey);
  const deploys: Visual = cells.length ? { kind: 'deploys', cells, summary: deploysSummary(cells) } : { kind: 'none' };
  const deploysNote = (): Note => ({
    head: `Deploys · the last ${countWord(cells.length || DEPLOY_DAYS)} days`,
    text: 'A numeral a day, oldest on the left, a dot for a quiet one and today underlined.',
    visual: deploys,
  });
  const p1: Seg[] = [
    T('When I accept one of its ideas, or hand it one of my own, a builder writes the change, tests it and puts it up for me to look at, and once I say yes it ships itself.'),
  ];
  const clauses: Seg[][] = [];
  if (b.days != null && b.deploysPerDay != null) {
    const since = longDate(b.firstDeploy);
    clauses.push([
      T('That’s been going for '),
      W('b-days', plural(b.days, 'day'), 'ink', {
        head: 'Since the first deploy',
        text: since ? `The record starts on ${since}, and every release since has been summarised from its own commits.` : 'Every release since the first has been summarised from its own commits.',
        visual: { kind: 'none' },
      }),
      T(' at about '),
      W('b-rate', `${fig(b.deploysPerDay, 1)} deploys a day`, 'ink', deploysNote()),
    ]);
    if (b.deploysToday != null)
      clauses[0].push(T(', with '), { t: 'word', id: 'b-today', word: b.deploysToday === 0 ? 'none' : countWord(b.deploysToday), tone: 'ink' }, T(' today so far'));
  } else if (b.deploysToday != null && cells.length) {
    // No release totals, but the day counts are in: say today's from those.
    clauses.push(
      b.deploysToday === 0
        ? [T('Nothing has shipped yet '), W('b-rate', 'today', 'ink', deploysNote())]
        : [T('Today it has shipped '), W('b-rate', plural(b.deploysToday, 'change'), 'ink', deploysNote()), T(' so far')],
    );
  }
  if (clauses.length && b.fromDaydream != null && b.fromDaydream > 0)
    clauses.push([
      W('b-dd', countWord(b.fromDaydream), 'ink', {
        head: 'Ideas from Daydream',
        text: 'Ideas the daydreamer raised that went through the same builder and the same review as mine.',
        href: '/projects/engine-room/daydream',
        cta: 'How Daydream works',
        visual: { kind: 'none' },
      }),
      T(` of the ideas it built came from Daydream`),
    ]);
  // No release record: the hero has said so already, so the chapter just
  // doesn't add the clause.
  if (clauses.length) p1.push(T(' '), ...joinClauses(clauses, ', and '), T('.'));

  const p2: Seg[] | null =
    b.linesWritten != null
      ? [
          T('Between them those releases have added '),
          W('b-lines', plural(b.linesWritten, 'line'), 'ink', {
            head: 'Lines written · every release',
            text: 'Lines added across every release, counted from each one’s own commits. Lines taken out aren’t subtracted, so it flatters.',
            href: '/projects/engine-room/build',
            cta: 'How it builds',
            visual: { kind: 'none' },
          }),
          T(' of code, very few of which I typed and all of which I have to live with.'),
        ]
      : null;

  const side = builderSide(c.v);
  return {
    id: 'build',
    nth: 4,
    numeral: 'iv.',
    label: 'The builder',
    head: 'It rewrites itself, then ships',
    tone: 'ink',
    ground: 'paper',
    figure: { value: b.releases, decimals: 0, unit: 'releases so far', spoken: NOT_ANSWERING },
    side: side ? [side] : [],
    margin: deploys.kind === 'deploys' ? { label: `Deploys · the last ${countWord(cells.length)} days`, visual: deploys } : null,
    p1,
    p2: p2 ? { sub: 'The damage', segs: p2 } : null,
    link: { href: '/projects/engine-room/build', text: 'How it builds' },
  };
}

/**
 * The closing lines: the rest of what the site does, each value word a link
 * rather than a footnote, as the index at the back of a feature would be.
 */
export function codaSegments(c: ShowcaseProps): Seg[] {
  const v = c.v;
  const L = (id: string, word: string, href: string, tone: Tone = 'accent'): Seg => ({ t: 'word', id, word, tone, href });
  const n = v?.canvas.count ?? 0;
  const out: Seg[] = [
    T('The site also runs '),
    L('c-canvas', n > 0 ? `${countWord(n)} job${n === 1 ? '' : 's'} of its own` : 'jobs of its own', '/projects/engine-room'),
    T(' on a timetable'),
  ];
  if (v?.canvas.lastRunAt && Number.isFinite(Date.parse(v.canvas.lastRunAt)))
    out.push(T(', the latest '), { t: 'word', id: 'c-ago', word: agoWords(v.canvas.lastRunAt, c.now), tone: 'accent' });
  out.push(T('. It answers back when I '), L('c-jkai', 'ask it something', '/projects/engine-room', 'ink'));
  const jobs = v?.jkai.activeJobs ?? null;
  if (jobs != null && jobs > 0) out.push(T(`, with ${countWord(jobs)} job${jobs === 1 ? '' : 's'} on the go just now`));
  out.push(T(', and keeps a corner for the family that stays '), L('c-family', 'between us', '/projects/engine-room/app'), T('.'));
  return out;
}

/** The line under the seam that carries the hero's sentence into the essay. */
export function standfirst(chapters: ChapterCopy[]): string {
  const notes = chapters.reduce((a, c) => a + [...c.p1, ...(c.p2?.segs ?? [])].filter((s) => s.t === 'word' && s.note).length, 0);
  const runs = `The long one runs to ${countWord(chapters.length)} chapters`;
  return `That’s the short version. ${notes ? `${runs} and ${countWord(notes)} more footnotes.` : `${runs}.`}`;
}

/* ----------------------------------------------------------- the assembly */

/** Every chapter in reading order (`extra` after the builder), footnotes numbered on from the hero's. */
export function sentenceChapters(p: ShowcaseProps, extra: ChapterCopy[] = []): ChapterCopy[] {
  const ctx: Ctx = { ...p, todayKey: localToday(new Date(p.now)) };
  return numberNotes([daydreamChapter(ctx), healthChapter(ctx), appChapter(ctx), buildChapter(ctx), ...extra]);
}

/** Numbers every footnoted word in reading order, starting after the hero's. */
export function numberNotes(chapters: ChapterCopy[], start = FIRST_NOTE): ChapterCopy[] {
  let n = start;
  const walk = (segs: Seg[]) => segs.map((s) => (s.t === 'word' && s.note ? { ...s, n: n++ } : s));
  return chapters.map((c) => ({ ...c, p1: walk(c.p1), p2: c.p2 ? { ...c.p2, segs: walk(c.p2.segs) } : null }));
}

/** The plain text of a run of segments, as a reader without the page hears it. */
export function plainText(segs: Seg[]): string {
  return segs.map((s) => (s.t === 'text' ? s.s : (s.spoken ?? s.word))).join('');
}

/** Every string a chapter prints, for the copy tests. */
export function chapterStrings(c: ChapterCopy): string[] {
  const notes = [...c.p1, ...(c.p2?.segs ?? [])].flatMap((s) =>
    s.t === 'word' && s.note
      ? [
          s.note.head,
          s.note.text,
          s.note.cta ?? '',
          ...('summary' in s.note.visual ? [s.note.visual.summary] : []),
          ...(s.note.visual.kind === 'list' ? s.note.visual.items : []),
          ...(s.note.visual.kind === 'quotes' ? s.note.visual.lines : []),
          ...(s.note.visual.kind === 'lives' ? s.note.visual.rows.map((r) => r.label) : []),
        ]
      : [],
  );
  return [
    c.numeral,
    c.label,
    c.head,
    c.figure.unit,
    c.figure.spoken,
    ...c.side.map((s) => s.text),
    plainText(c.p1),
    c.p2?.sub ?? '',
    c.p2 ? plainText(c.p2.segs) : '',
    c.link?.text ?? '',
    ...notes,
  ].filter(Boolean);
}

/* ------------------------------------------------------------- the layout */

export type Piece =
  | Exclude<Seg, { t: 'word' }>
  | (Extract<Seg, { t: 'word' }> & { end?: string })
  | { t: 'note'; id: string; n: number; tone: Tone; note: Note };

/**
 * Where each footnote's card sits in the paragraph: after the full stop of
 * the sentence its word is in, as a printed note follows its sentence, so an
 * open card never splits a clause in two. Text is split at that stop; any
 * notes still waiting at the end of the run follow it.
 */
export function layoutRun(segs: Seg[]): Piece[] {
  const out: Piece[] = [];
  let pending: Piece[] = [];
  for (const s of segs) {
    if (s.t === 'word') {
      out.push({ ...s });
      if (s.note && s.n != null) pending.push({ t: 'note', id: s.id, n: s.n, tone: s.tone, note: s.note });
      continue;
    }
    let rest = s.s;
    // Punctuation straight after a footnoted word is set before its number,
    // as type sets a note mark ("a minute,⁶" not "a minute⁶ ,").
    const prev = out[out.length - 1];
    const glue = /^[,.;?]/.exec(rest);
    if (glue && prev?.t === 'word' && prev.note) {
      prev.end = glue[0];
      rest = rest.slice(1);
      if (glue[0] === '.' || glue[0] === '?') {
        out.push(...pending);
        pending = [];
      }
    }
    while (pending.length) {
      const m = /[.?](?=\s|$)/.exec(rest);
      if (!m) break;
      out.push({ t: 'text', s: rest.slice(0, m.index + 1) });
      out.push(...pending);
      pending = [];
      rest = rest.slice(m.index + 1);
    }
    if (rest) out.push({ t: 'text', s: rest });
  }
  out.push(...pending);
  return out;
}
