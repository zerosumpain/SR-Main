// src/lib/constants/news-sources.ts
//
// The wired-in news sources, in the foundation layer so both the news module
// and anything that merely needs to KNOW what exists can read them.
//
// It lives here rather than in `$lib/news/types` because the daydream appetite
// scan states what the site can already reach, and a source list it cannot
// enumerate is a source list it will propose again — but `$lib/news` imports
// `$lib/daydream` (a story saved to the notebook), so reading it from there
// would close a `daydream <-> news` cycle. Nothing is imported here, and
// nothing may be: that is what keeps this file readable from either side.
//
// ── Adding a feed ────────────────────────────────────────────────────────────
//
// This file used to say that adding a source meant writing "a reader beside the
// existing readers in `$lib/news/sources.ts`", and that was true: Ars Technica
// arrived as eighty lines of bespoke RSS parsing, and its three-source list was
// then hand-repeated in `isNewsSource`, in the favourites source states, and in
// two `NEWS_SOURCE_LABELS`-shaped literals.
//
// A feed is now a ROW IN THE ARRAY BELOW. `$lib/news/feed.ts` reads RSS and Atom
// generically; `sources.ts` iterates this registry rather than naming its three
// wires. The only feeds that still need code are the two that are not feeds at
// all — Hacker News and Lobsters are JSON APIs with votes and comment counts,
// and they keep their own `kind`.
//
// It is still a code change rather than a database row, deliberately. The union
// type below is load-bearing — it types every story key, validates every
// `/news/[source]/[id]` request, and generates the `news_search` tool's `source`
// enum — and a source list assembled at runtime would erase all of that to let
// one person add a feed without a deploy. A registry that an autonomous loop
// could write would also be a list of URLs the server fetches on a schedule,
// which is a security surface this does not need.

/** How a source's stories are fetched. */
export type NewsSourceKind = 'hacker-news' | 'lobsters' | 'feed';

/**
 * Which half of the desk a source belongs to.
 *
 * The wire was entirely technical while half the work it is meant to serve is
 * public-sector, so the lane is what lets the desk carry both without either
 * drowning the other.
 */
export type NewsLane = 'tech' | 'public';

/**
 * `Id` is generic so the union below can still be DERIVED from the array rather
 * than hand-written beside it. Writing `id: NewsSource` here would be circular
 * — `NewsSource` is read back out of `NEWS_SOURCE_DEFS` — and writing the union
 * out by hand would reintroduce exactly the duplication this file removes.
 */
export interface NewsSourceDef<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
  /** Short badge shown on a row. Two or three characters. */
  readonly code: string;
  readonly kind: NewsSourceKind;
  readonly lane: NewsLane;
  /** Feed sources only — everything below is ignored for the two JSON APIs. */
  readonly feedUrl?: string;
  /** Every item link must sit on this origin, or the item is dropped. */
  readonly origin?: string;
  /**
   * Stricter shape for an article path, with the story id as capture group 1.
   * Omitted means "the last path segment", which is what GOV.UK and ONS use.
   */
  readonly pathPattern?: RegExp;
  /** `?paged=N` pagination, as WordPress serves it. */
  readonly paged?: boolean;
  /** WordPress `?name=<id>` single-article lookup. It survives feed expiry,
   *  which a plain re-scan of the current feed does not. */
  readonly wordpressNameLookup?: boolean;
  /** Fragment appended to an article URL to reach its comments. */
  readonly commentsAnchor?: string;
  readonly pageSize?: number;
}

export const NEWS_SOURCE_DEFS = [
  {
    id: 'hacker-news',
    label: 'Hacker News',
    code: 'HN',
    kind: 'hacker-news',
    lane: 'tech',
  },
  {
    id: 'lobsters',
    label: 'Lobsters',
    code: 'L',
    kind: 'lobsters',
    lane: 'tech',
  },
  {
    id: 'ars-technica',
    label: 'Ars Technica',
    code: 'ARS',
    kind: 'feed',
    lane: 'tech',
    feedUrl: 'https://arstechnica.com/feed/',
    origin: 'https://arstechnica.com',
    // Ars keeps the section and date in the path. Matching the whole shape
    // rather than taking the last segment is what stops a section index or a
    // tag page being mistaken for an article.
    pathPattern: /^\/[a-z0-9-]+\/\d{4}\/\d{2}\/([a-z0-9-]+)\/?$/,
    paged: true,
    wordpressNameLookup: true,
    commentsAnchor: '#comments',
    pageSize: 20,
  },
  // ── The public-sector lane ────────────────────────────────────────────────
  //
  // The desk was entirely technical while half the work it serves is public
  // sector. These three are Atom/RSS and were verified answering on 2026-09-15
  // before being added; two other candidates (publictechnology.net,
  // civilserviceworld.com) 404 on their advertised feed paths and are omitted
  // rather than shipped broken.
  //
  // None of them vote, so all three rank on `heat` — which is exactly the case
  // the per-source standing rule was written for.
  {
    id: 'govuk',
    label: 'GOV.UK',
    code: 'GOV',
    kind: 'feed',
    lane: 'public',
    feedUrl: 'https://www.gov.uk/search/news-and-communications.atom',
    origin: 'https://www.gov.uk',
    pageSize: 20,
  },
  {
    // The department feed overlaps the one above on purpose. A DfE
    // announcement carried by both is one story with two sightings, which is
    // what `alsoOn` is for — and it is a stronger signal than either alone.
    id: 'govuk-dfe',
    label: 'DfE',
    code: 'DFE',
    kind: 'feed',
    lane: 'public',
    feedUrl: 'https://www.gov.uk/government/organisations/department-for-education.atom',
    origin: 'https://www.gov.uk',
    pageSize: 20,
  },
  {
    id: 'ons',
    label: 'ONS',
    code: 'ONS',
    kind: 'feed',
    lane: 'public',
    feedUrl: 'https://www.ons.gov.uk/releasecalendar?rss',
    origin: 'https://www.ons.gov.uk',
    pageSize: 10,
  },
] as const satisfies readonly NewsSourceDef[];

export type NewsSource = (typeof NEWS_SOURCE_DEFS)[number]['id'];

export const NEWS_SOURCES = NEWS_SOURCE_DEFS.map((def) => def.id) as readonly NewsSource[];

export const NEWS_SOURCE_LABELS = Object.fromEntries(
  NEWS_SOURCE_DEFS.map((def) => [def.id, def.label]),
) as Record<NewsSource, string>;

export const NEWS_SOURCE_CODES = Object.fromEntries(
  NEWS_SOURCE_DEFS.map((def) => [def.id, def.code]),
) as Record<NewsSource, string>;

export function newsSourceDef(id: NewsSource): NewsSourceDef<NewsSource> {
  const found = NEWS_SOURCE_DEFS.find((def) => def.id === id);
  if (!found) throw new Error(`Unknown news source: ${id}`);
  return found;
}

export function isNewsSource(value: string): value is NewsSource {
  return NEWS_SOURCE_DEFS.some((def) => def.id === value);
}
