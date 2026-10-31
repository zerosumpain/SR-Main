// When a holiday deal is for, read from its own words — and whether that fits
// the dates asked for. PURE and deterministic, like `units.ts`: fixed patterns,
// so a verdict can show which words it read.
//
// Deal text writes dates a dozen ways (all seen in the hotukdeals holiday/
// hotel/flight/cruise tags and the HolidayPirates feed, 2026-10-31):
//
//   "12-17 Jan"  "28 Oct-11 Nov"  "8th - 13th Feb 2027"  "Thu 10-Mon 14 Dec"
//   "Jan 18-29"  "30 Nov"  "20 Feb 2027"  "13/11/26 to 28/02/27"
//   "Nov-Dec"  "Apr-Oct 27"  "Jan / Feb 2027"  "in early December"
//   "Various Dec Dates"  "May Half Term"  "24-26 Dec (Christmas)"
//
// Each becomes an interval with a PRECISION: a stated day ("12-17 Jan") is a
// trip, and must sit inside the window; a month ("in December", "Nov-Dec") is
// a season the deal runs in, and only has to overlap it. A year left out is
// the next one on or after the deal was posted. HolidayPirates adds "this
// holiday is completely customisable … many other departure dates", which
// makes the stated month the PRICE's month, not the only one — `flexible`.

export interface DateSpan {
  from: string; // YYYY-MM-DD
  to: string;
  precise: boolean;
}

export interface TravelDates {
  spans: DateSpan[];
  flexible: boolean;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const MON = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const DAY = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;
const WEEKDAY = String.raw`(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\.?\s+)?`;
const DASH = String.raw`\s*(?:-|–|—|to|until|till)\s*`;
const YEAR = String.raw`(?:\s*,?\s*(\d{4}|'\d{2}))?`;

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const month = (s: string) => MONTHS[s.toLowerCase()] ?? MONTHS[s.toLowerCase().slice(0, 3)];
function year(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace("'", ''));
  return n < 100 ? 2000 + n : n;
}

/** The year a month falls in when the text does not say: the next one on or after `asOf`'s month. */
function yearFor(m: number, asOf: Date): number {
  const y = asOf.getUTCFullYear();
  return m >= asOf.getUTCMonth() + 1 ? y : y + 1;
}

function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Easter Sunday (Anonymous Gregorian algorithm). */
function easter(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, mo, day);
}

/** Text a deal uses to say the stated dates are one option among many. */
const FLEXIBLE =
  /customis|many other (?:departure )?dates|other (?:\d{4} (?:and \d{4} )?)?dates|other months|lots of (?:departure )?dates|choose (?:your|from many) (?:dates|departure)|departure dates? available|flexible dates|change the (?:departure )?date|departure date \(between/i;

/**
 * Every date span a text states. Each pattern blanks what it read, so "12-17
 * Jan" is not read again as "17 Jan".
 */
export function readSpans(text: string, asOf: Date): DateSpan[] {
  let t = ` ${text} `;
  const spans: DateSpan[] = [];
  const take = (re: RegExp, fn: (m: string[], before: string, after: string) => DateSpan | null) => {
    t = t.replace(re, (...args) => {
      // replace() hands (match, ...groups, offset, whole) — no named groups here.
      const whole = args[args.length - 1] as string;
      const offset = args[args.length - 2] as number;
      const m = args.slice(0, -2).map((g) => (g === undefined ? undefined : String(g))) as string[];
      const span = fn(m, whole.slice(0, offset), whole.slice(offset + m[0].length));
      if (!span) return m[0];
      if (span.from <= span.to) spans.push(span);
      return ' '.repeat(m[0].length);
    });
  };
  const yr = (y: string | undefined, m: number) => year(y) ?? yearFor(m, asOf);

  // 13/11/26 to 28/02/27, 12/02/2027
  take(new RegExp(String.raw`\b(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})\b(?:${DASH}(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})\b)?`, 'gi'), (m) => {
    const a = iso(year(m[3])!, Number(m[2]), Number(m[1]));
    return { from: a, to: m[4] ? iso(year(m[6])!, Number(m[5]), Number(m[4])) : a, precise: true };
  });
  // 28 Oct-11 Nov, 8th - 13th Feb 2027, 12-17 Jan, Thu 10-Mon 14 Dec
  take(new RegExp(String.raw`\b${WEEKDAY}${DAY}(?:\s+${MON}${YEAR})?${DASH}${WEEKDAY}${DAY}\s+${MON}\b${YEAR}`, 'gi'), (m) => {
    const m2 = month(m[5]);
    const m1 = m[2] ? month(m[2]) : m2;
    const y2 = yr(m[6], m2);
    const y1 = m[3] ? year(m[3])! : m1 > m2 ? y2 - 1 : y2;
    return { from: iso(y1, m1, Number(m[1])), to: iso(y2, m2, Number(m[4])), precise: true };
  });
  // Jan 18-29, Feb 3rd - 7th 2027
  take(new RegExp(String.raw`\b${MON}\s+${DAY}${DASH}${DAY}\b${YEAR}`, 'gi'), (m) => {
    const mo = month(m[1]);
    const y = yr(m[4], mo);
    return { from: iso(y, mo, Number(m[2])), to: iso(y, mo, Number(m[3])), precise: true };
  });
  // 30 Nov, 20 Feb 2027, 24th April
  take(new RegExp(String.raw`\b${DAY}\s+${MON}\b${YEAR}`, 'gi'), (m) => {
    const mo = month(m[2]);
    const d = iso(yr(m[3], mo), mo, Number(m[1]));
    return { from: d, to: d, precise: true };
  });
  // Nov-Dec, Apr-Oct 27, Jan / Feb 2027 — a season
  take(new RegExp(String.raw`\b${MON}\s*(?:-|–|/|to|and|&)\s*${MON}\b(?:\s*,?\s*(\d{4}|'?\d{2})\b)?`, 'gi'), (m) => {
    const m1 = month(m[1]);
    const m2 = month(m[2]);
    const y2 = yr(m[3], m2);
    const y1 = m1 > m2 ? y2 - 1 : m[3] ? y2 : yr(undefined, m1);
    return { from: iso(y1, m1, 1), to: iso(y2, m2, daysIn(y2, m2)), precise: false };
  });
  // Christmas, New Year, Easter — by name. "Xmas markets", "Christmas lights"
  // and "Christmas shopping" are a theme, not the holiday: the markets run
  // from mid-November.
  take(/\b(christmas|xmas|new year|easter)\b(?!\s*(?:markets?|lights|shopping|jumpers?|trees?|gifts?|decorations?))/gi, (m) => {
    const name = m[1].toLowerCase();
    if (name === 'easter') {
      const y = asOf.getUTCMonth() + 1 > 4 ? asOf.getUTCFullYear() + 1 : asOf.getUTCFullYear();
      const sunday = easter(y);
      return { from: addDays(sunday, -9), to: addDays(sunday, 8), precise: false };
    }
    const y = asOf.getUTCFullYear();
    return name === 'new year' ? { from: iso(y, 12, 28), to: iso(y + 1, 1, 3), precise: false } : { from: iso(y, 12, 20), to: iso(y + 1, 1, 2), precise: false };
  });
  // in early December, mid-Jan, late March 2027, December — a month
  take(new RegExp(String.raw`\b(early|mid|late|end of|start of|beginning of)?[\s-]*${MON}\b${YEAR}`, 'gi'), (m, before, after) => {
    // "may" and "march" are verbs too. Written as a month they are capitalised,
    // and "May" also needs a month's company: "in May", "May half term",
    // "May 2027" — never "May you…".
    const raw = m[2];
    if (/^(may|march)$/i.test(raw) && raw[0] !== raw[0].toUpperCase()) return null;
    if (/^may$/i.test(raw) && !m[1] && !m[3] && !/\b(?:in|for|of|from|during|until|till)\s*$/i.test(before) && !/^\s*(?:half|-|–)/i.test(after)) return null;
    const mo = month(raw);
    const y = yr(m[3], mo);
    const last = daysIn(y, mo);
    const part = (m[1] ?? '').toLowerCase();
    const [a, b] = part === 'early' || part.startsWith('start') || part.startsWith('beginning') ? [1, 10] : part === 'mid' ? [11, 20] : part === 'late' || part === 'end of' ? [21, last] : [1, last];
    return { from: iso(y, mo, a), to: iso(y, mo, b), precise: false };
  });
  // Stated days outrank a stated season in the same text: "4-6 December … Xmas
  // markets" is a trip on the 4th, not any time over Christmas.
  return spans.some((x) => x.precise) ? spans.filter((x) => x.precise) : spans;
}

/**
 * The dates a listing states. Title first — a title is the deal; a description
 * wanders ("rooms can go for over £400 a night on some dates"). Flexibility is
 * read from both.
 */
export function readTravelDates(title: string, description: string, asOf: Date): TravelDates {
  const fromTitle = readSpans(title, asOf);
  return {
    spans: fromTitle.length ? fromTitle : readSpans(description, asOf),
    flexible: FLEXIBLE.test(`${title}\n${description}`),
  };
}

export interface DateFit {
  ok: boolean | null;
  reason: string;
}

const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const MONTH_ONLY = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const WITH_YEAR = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** A window as the page shows it: "13–21 Feb 2027", "19 Dec 2026–3 Jan 2027". */
export function formatWindow(from: string, to: string): string {
  const [a, b] = [new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`)];
  if (from === to) return WITH_YEAR.format(a);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${a.getUTCDate()}–${WITH_YEAR.format(b)}`;
  if (from.slice(0, 4) === to.slice(0, 4)) return `${SHORT.format(a)}–${WITH_YEAR.format(b)}`;
  return `${WITH_YEAR.format(a)}–${WITH_YEAR.format(b)}`;
}

export function formatSpan(s: DateSpan): string {
  const a = new Date(`${s.from}T00:00:00Z`);
  const b = new Date(`${s.to}T00:00:00Z`);
  if (!s.precise) {
    const ma = MONTH_ONLY.format(a);
    const mb = MONTH_ONLY.format(b);
    return ma === mb ? ma : `${ma.split(' ')[0]}–${mb}`;
  }
  return s.from === s.to ? SHORT.format(a) : `${SHORT.format(a)}–${SHORT.format(b)}`;
}

/** Slack either side of a stated trip: a Friday-night flight into a Saturday window still fits. */
const SLACK_DAYS = 2;

/**
 * Does a listing's stated timing fit the window? A stated trip must sit inside
 * it (give or take SLACK_DAYS); a stated season need only overlap it. Stated
 * and outside is a no — unless the deal says other dates are on offer, when
 * it is a Check: the price is for another month, but the trip may be had.
 */
export function fitDates(read: TravelDates, window: { from: string; to: string }): DateFit {
  const fits = read.spans.filter((s) =>
    s.precise ? s.from >= addDays(window.from, -SLACK_DAYS) && s.to <= addDays(window.to, SLACK_DAYS) : s.from <= window.to && s.to >= window.from,
  );
  if (fits.length) return { ok: true, reason: `${formatSpan(fits[0])}, in your dates` };
  if (!read.spans.length) return { ok: null, reason: read.flexible ? 'dates flexible, none stated' : 'dates not stated' };
  const stated = [...new Set(read.spans.map(formatSpan))].slice(0, 2).join(', ');
  return read.flexible
    ? { ok: null, reason: `priced for ${stated}; other dates offered` }
    : { ok: false, reason: `${stated}, outside your dates` };
}

/**
 * England's school holidays, for turning "February half term" into dates.
 * Councils differ by a few days, so these are the common pattern, weekends
 * included, and the page shows the dates an item ended up with. Extend by
 * adding the next school year.
 */
export const SCHOOL_HOLIDAYS: { name: string; from: string; to: string }[] = [
  { name: 'October half term 2026', from: '2026-10-24', to: '2026-11-01' },
  { name: 'Christmas holidays 2026', from: '2026-12-19', to: '2027-01-03' },
  { name: 'February half term 2027', from: '2027-02-13', to: '2027-02-21' },
  { name: 'Easter holidays 2027', from: '2027-03-27', to: '2027-04-11' },
  { name: 'May half term 2027', from: '2027-05-29', to: '2027-06-06' },
  { name: 'Summer holidays 2027', from: '2027-07-22', to: '2027-09-05' },
  { name: 'October half term 2027', from: '2027-10-23', to: '2027-10-31' },
  { name: 'Christmas holidays 2027', from: '2027-12-18', to: '2028-01-03' },
];
