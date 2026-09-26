/**
 * Owner read model over the release log.
 *
 * The counterpart to ./public. That module answers "what may an anonymous
 * visitor be told"; this one answers "everything, filtered". Both feed the ONE
 * page at /releases, which renders whichever payload its loader built — the
 * split lives in the loader and never in the template, because `{#if owner}`
 * still ships the bytes to the browser.
 *
 * Lifted out of /admin/ops/releases/+page.server.ts when that page was folded
 * into /releases (2026-09-07). A module rather than loader code so the route
 * stays a thin two-branch switch, and so the aggregation can be exercised
 * without rendering a page.
 */
import { and, asc, desc, eq, gte, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { releases, releaseItems } from '$lib/db/schema';
import { correctedFacts, correctedStats } from './corrected-facts';
import type { CommitFact, FileFact, ReleaseItemKind, ReleaseStats } from './types';

export const CONSOLE_PAGE_SIZE = 25;

export interface ConsoleFilters {
  kind: string;
  impact: string;
  via: string;
  q: string;
  from: string;
  to: string;
  page: number;
}

function dateParam(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const day = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value ? '' : value;
}

/** URL filters shared by the owner and public reads. Dates are inclusive UTC days. */
export function parseConsoleFilters(url: URL): ConsoleFilters {
  let from = dateParam(url.searchParams.get('from'));
  let to = dateParam(url.searchParams.get('to'));
  if (from && to && from > to) [from, to] = [to, from];
  return {
    kind: url.searchParams.get('kind') || 'all',
    impact: url.searchParams.get('impact') || 'all',
    via: url.searchParams.get('via') || 'all',
    q: (url.searchParams.get('q') || '').trim(),
    from,
    to,
    page: Math.max(0, parseInt(url.searchParams.get('page') || '0', 10) || 0),
  };
}

/**
 * One week of the cadence chart. Both audiences render the same shape: deploys
 * that landed, and the capabilities those deploys carried. For the public
 * branch `shipped` counts only publicly-describable items, so the lower series
 * never implies work the page may not name.
 */
export interface CadenceWeek {
  /** `YYYY-Www`, ISO week. */
  week: string;
  deploys: number;
  shipped: number;
  insertions: number;
  deletions: number;
}

export interface ReleaseMonth {
  month: string;
  deploys: number;
}

export interface ConsoleItem {
  id: number;
  kind: ReleaseItemKind;
  impact: string;
  title: string;
  summary: string;
  confidence: string;
  includes: string[];
  excludes: string[];
  surfaces: string[];
  files: string[];
  commits: string[];
}

export interface ConsoleRelease {
  id: number;
  version: string;
  sha: string;
  shortSha: string;
  prevSha: string | null;
  via: string;
  deployedAt: Date;
  title: string | null;
  summary: string | null;
  summaryStatus: string;
  summaryError: string | null;
  summaryModel: string | null;
  kinds: ReleaseItemKind[];
  stats: ReleaseStats;
  commits: CommitFact[];
  files: FileFact[];
  items: ConsoleItem[];
  itemCount: number;
  corrected: boolean;
}

export interface ConsoleTotals {
  releases: number;
  commits: number;
  files: number;
  insertions: number;
  deletions: number;
  pending: number;
  failed: number;
  minDate: string | null;
  maxDate: string | null;
}

export interface ConsolePayload {
  filters: ConsoleFilters;
  totals: ConsoleTotals;
  vias: { via: string; count: number }[];
  kindDist: { kind: string; count: number }[];
  cadence: CadenceWeek[];
  timeBuckets: ReleaseMonth[];
  items: ConsoleRelease[];
  hasMore: boolean;
}

/** ISO-8601 week label, `YYYY-Www` — the Thursday rule, so weeks never split a year twice. */
export function weekKey(d: Date): string {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((dt.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
    );
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Roll a dense day series up into the weekly shape the chart draws.
 *
 * The public payload's cadence is per-DAY over a 400-day range, which is far
 * more columns than the mark can carry; the owner's aggregate is per-week
 * already. Rolling the public one up here is what lets both audiences share one
 * chart component instead of two.
 */
export function weeklyCadence(
  days: { date: string; count: number; shipped: number; insertions?: number; deletions?: number }[],
  keep = 40,
): CadenceWeek[] {
  if (!days.length) return [];
  const by = new Map<string, CadenceWeek>();
  for (const d of days) {
    const key = weekKey(new Date(`${d.date}T00:00:00Z`));
    const row = by.get(key);
    if (row) {
      row.deploys += d.count;
      row.shipped += d.shipped;
      row.insertions += d.insertions ?? 0;
      row.deletions += d.deletions ?? 0;
    } else {
      by.set(key, {
        week: key, deploys: d.count, shipped: d.shipped,
        insertions: d.insertions ?? 0, deletions: d.deletions ?? 0,
      });
    }
  }
  const dates = days.map((day) => day.date).sort();
  const cursor = new Date(`${dates[0]}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7));
  const last = dates[dates.length - 1];
  const weeks: CadenceWeek[] = [];
  while (cursor.toISOString().slice(0, 10) <= last) {
    const week = weekKey(cursor);
    weeks.push(by.get(week) ?? { week, deploys: 0, shipped: 0, insertions: 0, deletions: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }
  return weeks.slice(-keep);
}

/** Fill empty months so a gap in deployments stays visible in the time filter. */
export function monthlyReleaseBuckets(days: { date: string; count: number }[]): ReleaseMonth[] {
  if (!days.length) return [];
  const counts = new Map<string, number>();
  for (const day of days) {
    const month = day.date.slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + day.count);
  }
  const keys = [...counts.keys()].sort();
  const cursor = new Date(`${keys[0]}-01T00:00:00Z`);
  const last = keys[keys.length - 1];
  const result: ReleaseMonth[] = [];
  while (cursor.toISOString().slice(0, 7) <= last) {
    const month = cursor.toISOString().slice(0, 7);
    result.push({ month, deploys: counts.get(month) ?? 0 });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return result;
}

export async function getReleaseConsole(filters: ConsoleFilters): Promise<ConsolePayload> {
  const { kind, impact, via, q, from, to, page } = filters;

  const clauses = [];
  if (via !== 'all') clauses.push(eq(releases.via, via));
  if (from) clauses.push(gte(releases.deployedAt, new Date(`${from}T00:00:00Z`)));
  if (to) {
    const nextDay = new Date(`${to}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    clauses.push(lt(releases.deployedAt, nextDay));
  }
  // kind/impact live on the items, so both filter the release by "has an item
  // matching". `kinds` is denormalised onto the release specifically so the kind
  // filter is an index-friendly containment test rather than a join.
  if (kind !== 'all') clauses.push(sql`${releases.kinds} @> ${JSON.stringify([kind])}::jsonb`);
  if (impact !== 'all') {
    clauses.push(
      sql`exists (select 1 from release_items ri where ri.release_id = ${releases.id} and ri.impact = ${impact})`,
    );
  }
  if (q) {
    const like = `%${q}%`;
    clauses.push(
      or(
        ilike(releases.title, like),
        ilike(releases.summary, like),
        ilike(releases.version, like),
        ilike(releases.shortSha, like),
        sql`exists (select 1 from release_items ri where ri.release_id = ${releases.id} and (ri.title ilike ${like} or ri.summary ilike ${like}))`,
      ),
    );
  }
  const where = clauses.length ? and(...clauses) : undefined;

  // ── aggregates over the whole (filtered) set ──
  const [agg, itemDayRows, viaRows, monthRows] = await Promise.all([
    db
      .select({
        id: releases.id,
        sha: releases.sha,
        deployedAt: releases.deployedAt,
        via: releases.via,
        stats: releases.stats,
        kinds: releases.kinds,
        summaryStatus: releases.summaryStatus,
      })
      .from(releases)
      .where(where),
    // Capabilities per day over the same filtered set, so the chart's lower
    // series answers "what did those deploys carry" rather than a second,
    // unrelated question. Grouped in Postgres — the ids are not needed here and
    // an `inArray` over 400-odd of them is a binding trap.
    db
      .select({
        day: sql<string>`to_char(${releases.deployedAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        n: sql<number>`count(*)::int`,
      })
      .from(releaseItems)
      .innerJoin(releases, eq(releases.id, releaseItems.releaseId))
      .where(where)
      .groupBy(sql`1`),
    db
      .select({ via: releases.via, n: sql<number>`count(*)::int` })
      .from(releases)
      .groupBy(releases.via)
      .orderBy(sql`count(*) desc`),
    db
      .select({
        month: sql<string>`to_char(${releases.deployedAt} at time zone 'UTC', 'YYYY-MM')`,
        n: sql<number>`count(*)::int`,
      })
      .from(releases)
      .groupBy(sql`1`),
  ]);

  let commits = 0;
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  let pending = 0;
  let failed = 0;
  const kindCounts: Record<string, number> = {};
  const deploysByDay = new Map<string, number>();
  const churnByDay = new Map<string, { insertions: number; deletions: number }>();
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const r of agg) {
    const s = correctedStats(r.sha,
      (r.stats as ReleaseStats) ?? { commits: 0, files: 0, insertions: 0, deletions: 0, prs: [] });
    commits += s.commits || 0;
    files += s.files || 0;
    insertions += s.insertions || 0;
    deletions += s.deletions || 0;
    if (r.summaryStatus === 'pending') pending += 1;
    if (r.summaryStatus === 'failed') failed += 1;
    for (const k of (r.kinds as string[]) || []) kindCounts[k] = (kindCounts[k] || 0) + 1;
    if (r.deployedAt) {
      const iso = new Date(r.deployedAt).toISOString().slice(0, 10);
      if (minDate === null || iso < minDate) minDate = iso;
      if (maxDate === null || iso > maxDate) maxDate = iso;
      deploysByDay.set(iso, (deploysByDay.get(iso) ?? 0) + 1);
      const churn = churnByDay.get(iso) ?? { insertions: 0, deletions: 0 };
      churn.insertions += s.insertions || 0;
      churn.deletions += s.deletions || 0;
      churnByDay.set(iso, churn);
    }
  }

  const shippedByDay = new Map(itemDayRows.map((r) => [r.day, r.n]));
  const cadence = weeklyCadence(
    [...deploysByDay.keys()].map((date) => ({
      date,
      count: deploysByDay.get(date) ?? 0,
      shipped: shippedByDay.get(date) ?? 0,
      insertions: churnByDay.get(date)?.insertions ?? 0,
      deletions: churnByDay.get(date)?.deletions ?? 0,
    })),
  );

  const kindDist = Object.entries(kindCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, count]) => ({ kind: k, count }));

  // ── the current page of releases ──
  const rows = await db
    .select()
    .from(releases)
    .where(where)
    .orderBy(desc(releases.deployedAt), desc(releases.id))
    .limit(CONSOLE_PAGE_SIZE)
    .offset(page * CONSOLE_PAGE_SIZE);

  const ids = rows.map((r) => r.id);
  const itemRows = ids.length
    ? await db
        .select()
        .from(releaseItems)
        .where(inArray(releaseItems.releaseId, ids))
        .orderBy(asc(releaseItems.releaseId), asc(releaseItems.ordinal))
    : [];
  const itemsByRelease: Record<number, typeof itemRows> = {};
  for (const it of itemRows) (itemsByRelease[it.releaseId] ??= []).push(it);

  // jsonb columns arrive as `unknown`; resolve every cast here so the page
  // template stays free of them.
  const items: ConsoleRelease[] = rows.map((r) => {
    const facts = correctedFacts(
      r.sha,
      r.prevSha,
      (r.commits as CommitFact[]) ?? [],
      (r.files as FileFact[]) ?? [],
    );
    return {
      id: r.id,
      version: r.version,
      sha: r.sha,
      shortSha: r.shortSha,
      prevSha: facts.prevSha,
      via: r.via,
      deployedAt: r.deployedAt,
      title: r.title,
      summary: r.summary,
      summaryStatus: r.summaryStatus,
      summaryError: r.summaryError,
      summaryModel: r.summaryModel,
      kinds: ((r.kinds as string[]) || []) as ReleaseItemKind[],
      stats: correctedStats(
        r.sha,
        (r.stats as ReleaseStats) ?? { commits: 0, files: 0, insertions: 0, deletions: 0, prs: [] },
      ),
      // Commit bodies are only read inside the detail modal; trimming them here
      // keeps a 25-release page from shipping ~1MB of prose.
      commits: facts.commits.map((c) => ({
        ...c,
        body: c.body && c.body.length > 600 ? c.body.slice(0, 600) + '…' : c.body,
      })),
      files: facts.files,
      items: (itemsByRelease[r.id] || [])
        .filter((it) => (kind === 'all' || it.kind === kind) && (impact === 'all' || it.impact === impact))
        .map((it) => ({
          id: it.id,
          kind: it.kind as ReleaseItemKind,
          impact: it.impact,
          title: it.title,
          summary: it.summary,
          confidence: it.confidence,
          includes: (it.includes as string[]) || [],
          excludes: (it.excludes as string[]) || [],
          surfaces: (it.surfaces as string[]) || [],
          files: (it.files as string[]) || [],
          commits: (it.commits as string[]) || [],
        })),
      itemCount: (itemsByRelease[r.id] || []).length,
      corrected: facts.corrected,
    };
  });

  return {
    filters,
    totals: {
      releases: agg.length,
      commits,
      files,
      insertions,
      deletions,
      pending,
      failed,
      minDate,
      maxDate,
    },
    vias: viaRows.map((v) => ({ via: v.via, count: v.n })),
    kindDist,
    cadence,
    timeBuckets: monthlyReleaseBuckets(monthRows.map((row) => ({ date: `${row.month}-01`, count: row.n }))),
    items,
    hasMore: rows.length === CONSOLE_PAGE_SIZE,
  };
}
