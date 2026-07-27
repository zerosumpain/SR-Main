import type { PageServerLoad } from './$types';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { releases, releaseItems } from '$lib/db/schema';
import type { CommitFact, FileFact, ReleaseItemKind, ReleaseStats } from '$lib/releases/types';

const PAGE_SIZE = 25;

export const load: PageServerLoad = async ({ url }) => {
  const kind = url.searchParams.get('kind') || 'all';
  const impact = url.searchParams.get('impact') || 'all';
  const via = url.searchParams.get('via') || 'all';
  const q = (url.searchParams.get('q') || '').trim();
  const page = Math.max(0, parseInt(url.searchParams.get('page') || '0', 10) || 0);

  const filters = [];
  if (via !== 'all') filters.push(eq(releases.via, via));
  // kind/impact live on the items, so both filter the release by "has an item
  // matching". `kinds` is denormalised onto the release specifically so the kind
  // filter is an index-friendly containment test rather than a join.
  if (kind !== 'all') filters.push(sql`${releases.kinds} @> ${JSON.stringify([kind])}::jsonb`);
  if (impact !== 'all') {
    filters.push(
      sql`exists (select 1 from release_items ri where ri.release_id = ${releases.id} and ri.impact = ${impact})`,
    );
  }
  if (q) {
    const like = `%${q}%`;
    filters.push(
      or(
        ilike(releases.title, like),
        ilike(releases.summary, like),
        ilike(releases.version, like),
        ilike(releases.shortSha, like),
        sql`exists (select 1 from release_items ri where ri.release_id = ${releases.id} and (ri.title ilike ${like} or ri.summary ilike ${like}))`,
      ),
    );
  }
  const where = filters.length ? and(...filters) : undefined;

  // ── aggregates over the whole (filtered) set ──
  const agg = await db
    .select({
      id: releases.id,
      deployedAt: releases.deployedAt,
      via: releases.via,
      stats: releases.stats,
      kinds: releases.kinds,
      summaryStatus: releases.summaryStatus,
    })
    .from(releases)
    .where(where);

  let commits = 0;
  let files = 0;
  let insertions = 0;
  let deletions = 0;
  let pending = 0;
  let failed = 0;
  const kindCounts: Record<string, number> = {};
  const byWeek: Record<string, number> = {};
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const r of agg) {
    const s = (r.stats as { commits?: number; files?: number; insertions?: number; deletions?: number }) || {};
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
      const wk = weekKey(new Date(r.deployedAt));
      byWeek[wk] = (byWeek[wk] || 0) + 1;
    }
  }

  const kindDist = Object.entries(kindCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, count]) => ({ kind: k, count }));
  const releaseSeries = Object.entries(byWeek)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-40)
    .map(([week, count]) => ({ week, count }));

  const viaRows = await db
    .select({ via: releases.via, n: sql<number>`count(*)::int` })
    .from(releases)
    .groupBy(releases.via)
    .orderBy(sql`count(*) desc`);

  // ── the current page of releases ──
  const rows = await db
    .select()
    .from(releases)
    .where(where)
    .orderBy(desc(releases.deployedAt), desc(releases.id))
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE);

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
  const items = rows.map((r) => ({
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
    filters: { kind, impact, via, q, page },
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
    releaseSeries,
    items,
    hasMore: rows.length === PAGE_SIZE,
  };
};

function weekKey(d: Date): string {
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
