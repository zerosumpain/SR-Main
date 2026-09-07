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
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { releases, releaseItems } from '$lib/db/schema';
import type { CommitFact, FileFact, ReleaseItemKind, ReleaseStats } from './types';

export const CONSOLE_PAGE_SIZE = 25;

export interface ConsoleFilters {
  kind: string;
  impact: string;
  via: string;
  q: string;
  page: number;
}

/** The five URL params the console reads, normalised. Shared with the public branch. */
export function parseConsoleFilters(url: URL): ConsoleFilters {
  return {
    kind: url.searchParams.get('kind') || 'all',
    impact: url.searchParams.get('impact') || 'all',
    via: url.searchParams.get('via') || 'all',
    q: (url.searchParams.get('q') || '').trim(),
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
  days: { date: string; count: number; shipped: number }[],
  keep = 40,
): CadenceWeek[] {
  const by = new Map<string, CadenceWeek>();
  for (const d of days) {
    const key = weekKey(new Date(`${d.date}T00:00:00Z`));
    const row = by.get(key);
    if (row) {
      row.deploys += d.count;
      row.shipped += d.shipped;
    } else {
      by.set(key, { week: key, deploys: d.count, shipped: d.shipped });
    }
  }
  return [...by.values()].sort((a, b) => a.week.localeCompare(b.week)).slice(-keep);
}

export async function getReleaseConsole(filters: ConsoleFilters): Promise<ConsolePayload> {
  const { kind, impact, via, q, page } = filters;

  const clauses = [];
  if (via !== 'all') clauses.push(eq(releases.via, via));
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
  const [agg, itemDayRows, viaRows] = await Promise.all([
    db
      .select({
        id: releases.id,
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
        day: sql<string>`to_char(${releases.deployedAt}, 'YYYY-MM-DD')`,
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
  ]);

  let commits = 0;
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  let pending = 0;
  let failed = 0;
  const kindCounts: Record<string, number> = {};
  const deploysByDay = new Map<string, number>();
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const r of agg) {
    const s =
      (r.stats as { commits?: number; files?: number; insertions?: number; deletions?: number }) || {};
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
    }
  }

  const shippedByDay = new Map(itemDayRows.map((r) => [r.day, r.n]));
  const cadence = weeklyCadence(
    [...deploysByDay.keys()].map((date) => ({
      date,
      count: deploysByDay.get(date) ?? 0,
      shipped: shippedByDay.get(date) ?? 0,
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
  const items: ConsoleRelease[] = rows.map((r) => ({
    id: r.id,
    version: r.version,
    sha: r.sha,
    shortSha: r.shortSha,
    prevSha: r.prevSha,
    via: r.via,
    deployedAt: r.deployedAt,
    title: r.title,
    summary: r.summary,
    summaryStatus: r.summaryStatus,
    summaryError: r.summaryError,
    summaryModel: r.summaryModel,
    kinds: ((r.kinds as string[]) || []) as ReleaseItemKind[],
    stats: (r.stats as ReleaseStats) ?? { commits: 0, files: 0, insertions: 0, deletions: 0, prs: [] },
    // Commit bodies are only read inside the detail modal; trimming them here
    // keeps a 25-release page from shipping ~1MB of prose.
    commits: ((r.commits as CommitFact[]) || []).map((c) => ({
      ...c,
      body: c.body && c.body.length > 600 ? c.body.slice(0, 600) + '…' : c.body,
    })),
    files: ((r.files as FileFact[]) || []) as FileFact[],
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
  }));

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
    items,
    hasMore: rows.length === CONSOLE_PAGE_SIZE,
  };
}
