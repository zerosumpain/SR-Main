// contents.ts — the pure sums behind the blog's contents pages (/blog and
// /blog/tag/[tag]): how a date is written in the margin, how the posts fall
// into years, and which subjects the run covers. Pure, so the server and the
// browser write every date the same way (London time, both sides, so a post
// published near midnight cannot hydrate into a different day) and the rules
// are unit tests (contents.test.ts).
import type { PostMeta } from '$lib/blog/types';

/** The fields a contents row reads. */
export type ContentsPost = Pick<PostMeta, 'slug' | 'title' | 'excerpt' | 'tags' | 'publishedAt' | 'coverImageUrl'>;

const ZONE = 'Europe/London';

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: ZONE });
const fullDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: ZONE });
const yearOnly = new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone: ZONE });
const isoParts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: ZONE });

function valid(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "28 Sept": the margin date. The year is the group's own heading. */
export function marginDate(d: Date | string | null | undefined): string {
  const date = valid(d);
  return date ? dayMonth.format(date) : '';
}

/** "28 Sept 2026": a date said in full (the stamp on the latest post). */
export function longDate(d: Date | string | null | undefined): string {
  const date = valid(d);
  return date ? fullDate.format(date) : '';
}

/** "2026-09-28": the machine date for a <time>, in the same zone as the words. */
export function isoDay(d: Date | string | null | undefined): string {
  const date = valid(d);
  return date ? isoParts.format(date) : '';
}

/** The year a post is filed under, or null when it has no date. */
export function yearOf(d: Date | string | null | undefined): string | null {
  const date = valid(d);
  return date ? yearOnly.format(date) : null;
}

export interface YearGroup<P> {
  /** The year as written, or null for undated posts (no heading). */
  year: string | null;
  /** The 1-based place of the group's first post in the whole run. */
  start: number;
  posts: P[];
}

/**
 * The run split where the year changes, keeping its order (newest first, as
 * the server sends it). A year that comes back later (an out-of-order date)
 * opens a new group rather than being pulled forward: the contents page
 * follows the run, it does not re-sort it.
 */
export function byYear<P extends Pick<PostMeta, 'publishedAt'>>(posts: P[]): YearGroup<P>[] {
  const groups: YearGroup<P>[] = [];
  posts.forEach((post, i) => {
    const year = yearOf(post.publishedAt);
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.posts.push(post);
    else groups.push({ year, start: i + 1, posts: [post] });
  });
  return groups;
}

export interface Subject {
  tag: string;
  count: number;
}

/** Every tag in the run with how many posts carry it: most used first, then A to Z. */
export function subjects(posts: Pick<PostMeta, 'tags'>[]): Subject[] {
  const counts = new Map<string, number>();
  for (const p of posts) for (const t of new Set(p.tags ?? [])) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** "no posts" / "one post" / "6 posts": a count said beside a tally. */
export function postCount(n: number): string {
  if (n === 0) return 'no posts';
  return n === 1 ? 'one post' : `${n} posts`;
}

/** The year of the run's first entry (the oldest dated post), or null. */
export function firstYear(posts: Pick<PostMeta, 'publishedAt'>[]): string | null {
  for (let i = posts.length - 1; i >= 0; i--) {
    const y = yearOf(posts[i].publishedAt);
    if (y) return y;
  }
  return null;
}

/**
 * Tallies stay legible, and inside a phone's column beside the longest
 * subject, to three gates; past that the marks become a smudge that would
 * push its row off the page, and the numeral says it better on its own.
 */
export const TALLY_LIMIT = 15;
