// Which of the hero's three views a visitor sees: the same live readings told
// as a sentence, drawn as a place, or kept as notes.
//
// A visitor who has chosen keeps their choice (a first-party cookie holding
// one word). Everyone else gets the notes.
//
// Pure: no DOM, no cookies API, no clock. The page's server load
// and HeroViews.svelte share it, and hero-view.test.ts pins the rules.

export const HERO_VIEWS = ['sentence', 'place', 'notes'] as const;
export type HeroView = (typeof HERO_VIEWS)[number];

/** The cookie a visitor's own choice lives in: one of HERO_VIEWS, nothing else. */
export const HERO_VIEW_COOKIE = 'sr_hero_view';
/** A year, in seconds, as Max-Age wants it. */
export const HERO_VIEW_MAX_AGE = 60 * 60 * 24 * 365;

/** What a visitor sees until they choose: the notes. */
export const DEFAULT_HERO_VIEW: HeroView = 'notes';

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
 * or null to forget the choice and go back to the default. First-party,
 * the whole site, Lax, and only a word in it.
 */
export function heroViewCookie(view: HeroView | null, secure = true): string {
  const tail = `; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`;
  return view ? `${HERO_VIEW_COOKIE}=${view}; Max-Age=${HERO_VIEW_MAX_AGE}${tail}` : `${HERO_VIEW_COOKIE}=; Max-Age=0${tail}`;
}

/* ------------------------------------------------------------- the choice */

export interface HeroViewChoice {
  /** What to render. */
  view: HeroView;
  /** The default view; choosing it again forgets the visitor's choice. */
  auto: HeroView;
  /** Where `view` came from: a ?view= link (never stored), the cookie, or the default. */
  source: 'query' | 'cookie' | 'auto';
}

/**
 * The view to render: a ?view= link first (for sharing and QA, never
 * remembered), then the visitor's own choice, then the default.
 */
export function chooseHeroView(input: { query?: string | null; cookie?: string | null }): HeroViewChoice {
  const auto = DEFAULT_HERO_VIEW;
  const query = parseHeroView(input.query);
  if (query) return { view: query, auto, source: 'query' };
  const cookie = parseHeroView(input.cookie);
  if (cookie) return { view: cookie, auto, source: 'cookie' };
  return { view: auto, auto, source: 'auto' };
}

/**
 * What to store when a visitor picks a view: that view, or null (forget) when
 * it is the default anyway. One rule keeps "auto" without a fourth button:
 * pick the default and the cookie is gone.
 */
export function storedChoice(picked: HeroView): HeroView | null {
  return picked === DEFAULT_HERO_VIEW ? null : picked;
}
