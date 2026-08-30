/**
 * Reader analytics — the database half.
 *
 * Server-only by name. Everything here returns through `summariseViews` in
 * ./analytics, so there is exactly ONE aggregation implementation and it is the
 * one covered by tests. Nothing in this file recomputes a statistic in SQL.
 */

import { db } from '$lib/db';
import { blogPostViews } from '$lib/db/schema';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { summariseViews, type ReadStats, type ViewRow } from './analytics';

const DAY_MS = 86_400_000;

// A non-finite or non-positive window would select everything or nothing with
// no complaint. Clamped to a day so a bad caller gets a small honest window
// rather than an unbounded scan of the busiest table on the blog.
function windowStart(days: number): Date {
  const d = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 30;
  return new Date(Date.now() - d * DAY_MS);
}

// Filtered on `createdAt` — when the read began — not `updatedAt`. That is the
// column `blog_post_views_post_created_idx` covers, and a long read whose final
// beacon lands after midnight belongs to the day it started, not the day it
// stopped.
const VIEW_COLUMNS = {
  postId: blogPostViews.postId,
  dwellMs: blogPostViews.dwellMs,
  maxScrollPct: blogPostViews.maxScrollPct,
  completed: blogPostViews.completed,
  referrerHost: blogPostViews.referrerHost,
  deviceClass: blogPostViews.deviceClass,
  createdAt: blogPostViews.createdAt,
} as const;

export async function readStatsForPost(postId: number, days: number): Promise<ReadStats> {
  const rows = await db
    .select(VIEW_COLUMNS)
    .from(blogPostViews)
    .where(
      and(eq(blogPostViews.postId, postId), gte(blogPostViews.createdAt, windowStart(days))),
    );
  return summariseViews(rows);
}

/**
 * ONE query for every id, then grouped in JS through the same pure function.
 *
 * The admin list renders every post on the page with its stats; a per-post
 * query in a loader is the documented performance trap in this repo, and it
 * degrades exactly where it is least visible — fine on a dev box with nine
 * posts, ugly on production with a few hundred.
 */
export async function readStatsForPosts(
  postIds: number[],
  days: number,
): Promise<Map<number, ReadStats>> {
  const out = new Map<number, ReadStats>();
  const ids = [...new Set(postIds)].filter((id) => Number.isInteger(id));
  // `inArray` with an empty list builds SQL that is at best a no-op and at
  // worst invalid, so the empty case never reaches the database.
  if (ids.length === 0) return out;

  const rows = await db
    .select(VIEW_COLUMNS)
    .from(blogPostViews)
    .where(and(inArray(blogPostViews.postId, ids), gte(blogPostViews.createdAt, windowStart(days))));

  const grouped = new Map<number, ViewRow[]>();
  for (const row of rows) {
    const existing = grouped.get(row.postId);
    if (existing) existing.push(row);
    else grouped.set(row.postId, [row]);
  }

  // Every requested id gets an entry, including posts nobody read. A missing
  // key would force each call site to invent its own zero state, and
  // `summariseViews([])` already is that zero state.
  for (const id of ids) out.set(id, summariseViews(grouped.get(id) ?? []));
  return out;
}
