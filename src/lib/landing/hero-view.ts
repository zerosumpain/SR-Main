// Which of the hero's three views a visitor sees: the same live readings told
// as a sentence, drawn as a place, or kept as notes.
//
// A visitor who has chosen keeps their choice (a first-party cookie holding
// one word). Everyone else gets the view that suits the hour in London:
//
//   - after dusk and before dawn, the place: the day drawn as a landscape
//     under a night sky;
//   - Saturday and Sunday daytime, the notes;
//   - weekday daytime, the sentence.
//
// "Dusk" is civil dusk, the sun 6° under the horizon, worked out from the
// date for a point in the middle of Britain (54.5°N, 2°W). It is a few
// minutes out for Penzance or Lerwick, which is near enough for choosing a
// picture; a fixed 19:00–07:00 rule would have shown the night scene in
// broad daylight for most of the summer and the day scene in the dark for
// most of the winter. Everything is compared as instants, so the clocks
// changing (BST to GMT and back) never needs handling.
//
// Pure: no DOM, no cookies API, no clock of its own. The page's server load
// and HeroViews.svelte share it, and hero-view.test.ts pins the rules.

export const HERO_VIEWS = ['sentence', 'place', 'notes'] as const;
export type HeroView = (typeof HERO_VIEWS)[number];

/** The cookie a visitor's own choice lives in: one of HERO_VIEWS, nothing else. */
export const HERO_VIEW_COOKIE = 'sr_hero_view';
/** A year, in seconds, as Max-Age wants it. */
export const HERO_VIEW_MAX_AGE = 60 * 60 * 24 * 365;

/** Where the hour is read: the owner's day, as the dateline and the steps keep it. */
const ZONE = 'Europe/London';
/** The middle of Britain, near enough for dusk to the nearest few minutes. */
const LAT = 54.5;
const LON = -2;
/** Civil twilight: the sun six degrees under the horizon. */
const DUSK_ALTITUDE = -6;

export function isHeroView(x: unknown): x is HeroView {
  return typeof x === 'string' && (HERO_VIEWS as readonly string[]).includes(x);
}

/**
 * A raw ?view= or cookie value as a view, or null for anything else (missing,
 * empty, unknown, odd case): a cookie is the visitor's to edit, so it is
 * read as untrusted input.
 */
export function parseHeroView(raw: string | null | undefined): HeroView | null {
  const v = raw?.trim();
  return isHeroView(v) ? v : null;
}

/**
 * The Set-Cookie string for `document.cookie`: a chosen view kept for a year,
 * or null to forget the choice and go back to the hour's default. First-party,
 * the whole site, Lax, and only a word in it.
 */
export function heroViewCookie(view: HeroView | null, secure = true): string {
  const tail = `; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
  return view ? `${HERO_VIEW_COOKIE}=${view}; Max-Age=${HERO_VIEW_MAX_AGE}${tail}` : `${HERO_VIEW_COOKIE}=; Max-Age=0${tail}`;
}

/* ---------------------------------------------------------------- the hour */

export interface LondonDay {
  /** 0 Sunday … 6 Saturday, in London. */
  weekday: number;
  year: number;
  month: number;
  day: number;
}

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  weekday: 'short',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The calendar day it is in London at `at`, whatever the server's own zone. */
export function londonDay(at: Date): LondonDay {
  const p = Object.fromEntries(parts.formatToParts(at).map((x) => [x.type, x.value]));
  return { weekday: WEEKDAYS.indexOf(p.weekday), year: +p.year, month: +p.month, day: +p.day };
}

const rad = Math.PI / 180;

/**
 * Civil dawn and dusk as instants for one calendar day, from the usual
 * low-precision solar formulas (declination and the equation of time from the
 * day of the year). Good to a few minutes, which is all a choice of picture
 * needs. Never polar at 54.5°N, so both always exist.
 */
export function twilight(year: number, month: number, day: number): { dawn: number; dusk: number } {
  const midnight = Date.UTC(year, month - 1, day);
  const n = Math.round((midnight - Date.UTC(year, 0, 0)) / 86_400_000);
  const g = ((2 * Math.PI) / 365) * (n - 1);
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  // Minutes the sundial runs ahead of the clock.
  const eot =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const cosH =
    (Math.sin(DUSK_ALTITUDE * rad) - Math.sin(LAT * rad) * Math.sin(decl)) / (Math.cos(LAT * rad) * Math.cos(decl));
  const half = Math.acos(Math.min(1, Math.max(-1, cosH))) / rad; // degrees either side of noon
  const noon = 720 - 4 * LON - eot; // minutes after UTC midnight
  // Whole milliseconds, as a Date holds them.
  return { dawn: Math.round(midnight + (noon - 4 * half) * 60_000), dusk: Math.round(midnight + (noon + 4 * half) * 60_000) };
}

/** True between civil dusk and the next civil dawn, at the middle of Britain. */
export function isDark(at: Date): boolean {
  const d = londonDay(at);
  const { dawn, dusk } = twilight(d.year, d.month, d.day);
  const t = at.getTime();
  return t < dawn || t >= dusk;
}

/** The view that suits the hour: place in the dark, notes at the weekend, else the sentence. */
export function defaultHeroView(at: Date): HeroView {
  if (isDark(at)) return 'place';
  const { weekday } = londonDay(at);
  return weekday === 0 || weekday === 6 ? 'notes' : 'sentence';
}

/* ------------------------------------------------------------- the choice */

export interface HeroViewChoice {
  /** What to render. */
  view: HeroView;
  /** What the hour alone would pick; choosing this again forgets the visitor's choice. */
  auto: HeroView;
  /** Where `view` came from: a ?view= link (never stored), the cookie, or the hour. */
  source: 'query' | 'cookie' | 'auto';
}

/**
 * The view to render: a ?view= link first (for sharing and QA, never
 * remembered), then the visitor's own choice, then the hour's.
 */
export function chooseHeroView(input: { query?: string | null; cookie?: string | null; at: Date }): HeroViewChoice {
  const auto = defaultHeroView(input.at);
  const query = parseHeroView(input.query);
  if (query) return { view: query, auto, source: 'query' };
  const cookie = parseHeroView(input.cookie);
  if (cookie) return { view: cookie, auto, source: 'cookie' };
  return { view: auto, auto, source: 'auto' };
}

/**
 * What to store when a visitor picks a view: that view, or null (forget) when
 * it is the one the hour would show anyway. One rule keeps "auto" without a
 * fourth button: pick the default and you are back on the hour.
 */
export function storedChoice(picked: HeroView, auto: HeroView): HeroView | null {
  return picked === auto ? null : picked;
}
