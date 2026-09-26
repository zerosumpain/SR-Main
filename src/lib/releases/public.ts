/**
 * Public, anonymised read model over the release log.
 *
 * The owner branch of /releases holds the full truth (see ./console); this
 * module is what the landing page and the public release history may see.
 * Everything item-shaped passes through $lib/releases/public-filter first —
 * see that file for why the safe set is smaller than the real one.
 *
 * Two deliberate asymmetries:
 *
 *  - Headline COUNTS come from every release, including the internal ones. A
 *    bare "418 releases / 690k lines" discloses nothing and is the honest
 *    measure of the work; withholding it would undersell the site for no gain.
 *  - Item TEXT comes only from the safe subset. Naming what shipped is where
 *    disclosure risk actually lives.
 *
 * Shaped like $lib/../routes/api/landing/vitals: one memo cache, fail-soft, and
 * never a leak of anything a visitor could not already reach.
 */

import { db } from '$lib/db';
import { releases, releaseItems, projectVisibility } from '$lib/db/schema';
import { desc, sql } from 'drizzle-orm';
import { isItemPublic, redactItem } from './public-filter';
import { correctedStats } from './corrected-facts';
import type { ReleaseItemKind, ReleaseStats } from './types';

/** Release data only changes when a deploy lands, so this can be generous. */
const CACHE_MS = 5 * 60_000;

export interface ShowcaseTotals {
  releases: number;
  commits: number;
  files: number;
  insertions: number;
  deletions: number;
  /** Distinct items the public view can describe (not the full 1,056). */
  shipped: number;
  firstDeploy: string | null;
  lastDeploy: string | null;
  /** Whole days between first and last deploy, inclusive. */
  days: number;
}

/**
 * One day of shipping activity. Sparse days are present with zeroes so the
 * chart can index by position and never has to reason about gaps.
 */
export interface CadenceDay {
  /** YYYY-MM-DD */
  date: string;
  /** Deploys that landed that day. */
  count: number;
  /** Publicly-describable capabilities those deploys carried. */
  shipped: number;
  /** Code churn from all recorded releases, as in the public headline totals. */
  insertions: number;
  deletions: number;
}

export interface KindSlice {
  kind: ReleaseItemKind | string;
  count: number;
}

export interface ShowcaseItem {
  kind: ReleaseItemKind | string;
  title: string;
  summary: string;
  surfaces: string[];
  /** Parent release, for chronology — version is a date-derived label. */
  version: string;
  deployedAt: string;
}

export interface ShowcasePayload {
  totals: ShowcaseTotals;
  cadence: CadenceDay[];
  kindMix: KindSlice[];
  items: ShowcaseItem[];
  generatedAt: string;
}

let cache: { at: number; data: ShowcasePayload } | null = null;

/** `key -> isPublic`; absence means public (see $lib/projects/visibility). */
async function visibilityMap(): Promise<Record<string, boolean>> {
  const rows = await db
    .select({ key: projectVisibility.projectKey, isPublic: projectVisibility.isPublic })
    .from(projectVisibility);
  return Object.fromEntries(rows.map((r) => [r.key, r.isPublic]));
}

/** Fill every day between first and last so the cadence chart has no gaps. */
function denseCadence(
  deploys: Map<string, { count: number; insertions: number; deletions: number }>,
  shipped: Map<string, number>,
  from: Date,
  to: Date,
): CadenceDay[] {
  const out: CadenceDay[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  while (cursor.getTime() <= end) {
    const iso = cursor.toISOString().slice(0, 10);
    const day = deploys.get(iso);
    out.push({
      date: iso,
      count: day?.count ?? 0,
      shipped: shipped.get(iso) ?? 0,
      insertions: day?.insertions ?? 0,
      deletions: day?.deletions ?? 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

const EMPTY: ShowcasePayload = {
  totals: {
    releases: 0, commits: 0, files: 0, insertions: 0, deletions: 0,
    shipped: 0, firstDeploy: null, lastDeploy: null, days: 0,
  },
  cadence: [],
  kindMix: [],
  items: [],
  generatedAt: new Date(0).toISOString(),
};

async function compute(): Promise<ShowcasePayload> {
  const [statRows, itemRows, vis] = await Promise.all([
    // Keep the release boundary beside its stats so a known empty-tree import
    // can be repaired before either the headline or the weekly chart sums it.
    db
      .select({
        sha: releases.sha,
        stats: releases.stats,
        deployedAt: releases.deployedAt,
      })
      .from(releases),
    // Every summarised item, newest first. 1,056 rows of short text is a single
    // cheap read, and the safety filter has to run in Node anyway — it depends
    // on the visibility map and on prose matching.
    db
      .select({
        kind: releaseItems.kind,
        impact: releaseItems.impact,
        title: releaseItems.title,
        summary: releaseItems.summary,
        surfaces: releaseItems.surfaces,
        confidence: releaseItems.confidence,
        version: releases.version,
        deployedAt: releases.deployedAt,
      })
      .from(releaseItems)
      .innerJoin(releases, sql`${releases.id} = ${releaseItems.releaseId}`)
      .orderBy(desc(releases.deployedAt), desc(releaseItems.ordinal)),
    visibilityMap(),
  ]);

  let first: Date | null = null;
  let last: Date | null = null;
  const totals = { commits: 0, files: 0, insertions: 0, deletions: 0 };
  const dayCounts = new Map<string, { count: number; insertions: number; deletions: number }>();
  for (const row of statRows) {
    const at = new Date(row.deployedAt);
    if (!first || at < first) first = at;
    if (!last || at > last) last = at;
    const stats = correctedStats(row.sha, row.stats as ReleaseStats);
    totals.commits += stats.commits ?? 0;
    totals.files += stats.files ?? 0;
    totals.insertions += stats.insertions ?? 0;
    totals.deletions += stats.deletions ?? 0;
    const day = at.toISOString().slice(0, 10);
    const bucket = dayCounts.get(day) ?? { count: 0, insertions: 0, deletions: 0 };
    bucket.count++;
    bucket.insertions += stats.insertions ?? 0;
    bucket.deletions += stats.deletions ?? 0;
    dayCounts.set(day, bucket);
  }

  const safe = itemRows.filter((r) =>
    isItemPublic({ ...r, surfaces: (r.surfaces as string[]) ?? [] }, vis),
  );

  const kindCounts = new Map<string, number>();
  for (const r of safe) kindCounts.set(r.kind, (kindCounts.get(r.kind) ?? 0) + 1);

  // Capabilities per day, counted from the SAFE set only — so the lower comb
  // never implies work the page is not allowed to describe.
  const shippedByDay = new Map<string, number>();
  for (const r of safe) {
    const iso = new Date(r.deployedAt).toISOString().slice(0, 10);
    shippedByDay.set(iso, (shippedByDay.get(iso) ?? 0) + 1);
  }

  return {
    totals: {
      releases: statRows.length,
      ...totals,
      shipped: safe.length,
      firstDeploy: first ? first.toISOString() : null,
      lastDeploy: last ? last.toISOString() : null,
      days:
        first && last
          ? Math.max(1, Math.round((last.getTime() - first.getTime()) / 86_400_000) + 1)
          : 0,
    },
    cadence: first && last ? denseCadence(dayCounts, shippedByDay, first, last) : [],
    kindMix: [...kindCounts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count),
    items: safe.map((r) => ({
      ...redactItem({ ...r, surfaces: (r.surfaces as string[]) ?? [] }, vis),
      version: r.version,
      deployedAt: new Date(r.deployedAt).toISOString(),
    })),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * The whole public read model, memoised.
 *
 * The cache always holds the FULL safe item list (a few hundred short rows —
 * well under a megabyte) and callers slice it. Keying the cache on `limit`
 * instead would mean a small-limit caller could evict a large-limit one, and a
 * later large request would silently get the short list back.
 *
 * Fails soft to an empty payload: the landing page must never 500 because a
 * showcase section could not load.
 */
export async function getReleaseShowcase(limit?: number): Promise<ShowcasePayload> {
  let data = cache && Date.now() - cache.at < CACHE_MS ? cache.data : null;
  if (!data) {
    try {
      data = await compute();
      cache = { at: Date.now(), data };
    } catch (err) {
      console.error('[releases/public] compute failed:', err);
      return { ...EMPTY, generatedAt: new Date().toISOString() };
    }
  }
  if (limit === undefined || limit >= data.items.length) return data;
  return { ...data, items: data.items.slice(0, limit) };
}

/** Test seam — drops the memo so a following read recomputes. */
export function _resetShowcaseCache(): void {
  cache = null;
}
