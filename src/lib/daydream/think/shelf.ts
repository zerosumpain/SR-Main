// src/lib/daydream/think/shelf.ts
//
// When a note has probably stopped mattering. PURE.
//
// A note about a walk on 16 October is still sitting in "Your call" on the
// 25th, worded as if it were news, until the feed's 30-day window drops it
// without a word. Nothing said it had gone stale. This works out a day after
// which each note is LIKELY past it, and the feed flags an unanswered note
// once that day has gone. It flags; it does not file. Filing is his tap, and a
// note he has answered is his record and is never flagged.
//
// The day comes from the first of these that applies:
//   1. `relevant_until` on the row — the think loop's own estimate when it
//      wrote the note, or his "Still relevant", which pushes it on;
//   2. the latest date the note names that was still ahead when it was
//      written — an event, a deadline, a renewal. A date already past when the
//      note was written is the data it read ("you spent £40 on 3 October"),
//      not a date the note is about, so it does not count;
//   3. a short shelf life, counted from when it was written.
//
// Days are London days compared as `YYYY-MM-DD` strings: "past its date" is a
// calendar question, and a timestamp comparison would flag a note at 23:00 the
// night before.

export const LOCAL_TZ = 'Europe/London';

/** Days an undated note is likely to matter, from when it was written.
 *
 * Three, for every kind. The first cut (10 days for a health plan up to 60
 * for a build idea) flagged almost nothing in production: on 11 October all
 * 275 notes were under 16 days old and 151 unanswered ones over three, and
 * those were the ones he called timed out. The loop writes ~20 a day, so a
 * note nobody has answered in three days has been buried by newer ones. A
 * note that names a later date still lasts until that date. */
export const SHELF_DAYS = 3;

/** How far ahead a named date may be and still count as the note's subject. */
const MAX_AHEAD_DAYS = 366;
/** Days a note may carry the flag, unanswered, before the sweep files it.
 *  A week: long enough that a flag is seen at least once on an ordinary
 *  week's visits, short enough that the Inbox does not fill with flags. */
export const SWEEP_GRACE_DAYS = 7;
/** "Still relevant" keeps a note off the flag for this long. */
export const KEEP_DAYS = 14;

export function localDayOf(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: LOCAL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** A London day as the timestamp `relevant_until` stores: midday UTC, which
 *  is the same London day in summer and winter, so it reads back unchanged. */
export function dayToStored(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const monthNum = (word: string): number => MONTHS[word.toLowerCase().slice(0, 3)];
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?';
const YEAR = '(?:,?\\s+(\\d{4}))?';
const ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const DAY_MONTH_RE = new RegExp(`\\b${DAY}\\s+(?:of\\s+)?${MONTH}\\b${YEAR}`, 'gi');
const MONTH_DAY_RE = new RegExp(`\\b${MONTH}\\s+${DAY}\\b${YEAR}`, 'gi');

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // Rejects 31 November and friends.
  return new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s ? s : null;
}

/** A yearless date takes the year that puts it nearest after the note was
 *  written: "5 January" in a December note is next January. */
function withYear(m: number, d: number, year: string | undefined, writtenDay: string): string | null {
  if (year) return iso(Number(year), m, d);
  const y = Number(writtenDay.slice(0, 4));
  const same = iso(y, m, d);
  if (!same) return null;
  return daysBetween(same, writtenDay) > 60 ? iso(y + 1, m, d) : same;
}

/** Every calendar date the text names, as `YYYY-MM-DD`. */
export function datesIn(text: string, writtenDay: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(ISO_RE)) {
    const s = iso(Number(m[1]), Number(m[2]), Number(m[3]));
    if (s) out.push(s);
  }
  for (const m of text.matchAll(DAY_MONTH_RE)) {
    const s = withYear(monthNum(m[2]), Number(m[1]), m[3], writtenDay);
    if (s) out.push(s);
  }
  for (const m of text.matchAll(MONTH_DAY_RE)) {
    const s = withYear(monthNum(m[1]), Number(m[2]), m[3], writtenDay);
    if (s) out.push(s);
  }
  return out;
}

/** The date a note is about: the latest it names that was still ahead when it
 *  was written. Latest, because "book by 10 October for the 1 November walk"
 *  matters until the walk. Null when it names none. */
export function eventDayOf(text: string, writtenDay: string): string | null {
  const ahead = datesIn(text, writtenDay).filter((d) => d >= writtenDay && daysBetween(writtenDay, d) <= MAX_AHEAD_DAYS);
  return ahead.length ? ahead.sort().at(-1)! : null;
}

export type ShelfBasis = 'stated' | 'date' | 'age';

export interface Shelf {
  /** The last London day the note is likely to matter. */
  until: string;
  basis: ShelfBasis;
}

export interface ShelfInput {
  kind: string;
  title: string;
  narrative: string | null;
  explanation?: string;
  createdAt: Date;
  relevantUntil?: Date | null;
}

export function shelfOf(row: ShelfInput): Shelf {
  if (row.relevantUntil) return { until: localDayOf(row.relevantUntil), basis: 'stated' };
  const written = localDayOf(row.createdAt);
  const event = eventDayOf(`${row.title}\n${row.narrative ?? row.explanation ?? ''}`, written);
  if (event) return { until: event, basis: 'date' };
  return { until: addDays(written, SHELF_DAYS), basis: 'age' };
}

export interface Staleness {
  /** The last day it was likely to matter (`YYYY-MM-DD`). */
  until: string;
  basis: ShelfBasis;
  /** One sentence for the card. */
  why: string;
}

function shortDay(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
}

function weeks(n: number): string {
  if (n < 14) return `${n} days`;
  const w = Math.round(n / 7);
  return `${w} weeks`;
}

/**
 * Is this note probably past it? Null when not. Only a note still at
 * "Spotted" (`explain.ts` noteStage) is ever flagged — nothing rated, ruled,
 * done, checked or followed up. Anything further along is his record, or is
 * still doing something.
 */
export function stalenessOf(row: ShelfInput, opts: { stage: string; now: Date }): Staleness | null {
  if (opts.stage !== 'spotted') return null;
  const shelf = shelfOf(row);
  const today = localDayOf(opts.now);
  if (today <= shelf.until) return null;
  const why =
    shelf.basis === 'date'
      ? `The date it is about, ${shortDay(shelf.until)}, has passed.`
      : shelf.basis === 'stated'
        ? `It was expected to matter until ${shortDay(shelf.until)}.`
        : `${weeks(daysBetween(localDayOf(row.createdAt), today))} old and unanswered — it has probably moved on.`;
  return { until: shelf.until, basis: shelf.basis, why };
}

/** The day "Still relevant" keeps a note to. */
export function keptUntil(now: Date): string {
  return addDays(localDayOf(now), KEEP_DAYS);
}

/** The think loop's `until`: a real day, not before the day it was written,
 *  not more than a year on. Anything else is dropped, not repaired. */
export function parseUntil(raw: unknown, today: string): string | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const day = iso(Number(m[1]), Number(m[2]), Number(m[3]));
  if (!day || day < today || daysBetween(today, day) > MAX_AHEAD_DAYS) return null;
  return day;
}

/** Has this flag been up long enough for the sweep to file the note? Only a
 *  flagged note can be swept, so everything `stalenessOf` protects — anything
 *  answered or under way — is protected here too. */
export function sweepDue(stale: Pick<Staleness, 'until'> | null, now: Date): boolean {
  return !!stale && daysBetween(stale.until, localDayOf(now)) > SWEEP_GRACE_DAYS;
}
