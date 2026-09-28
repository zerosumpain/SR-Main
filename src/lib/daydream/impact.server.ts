// src/lib/daydream/impact.server.ts
//
// The reads behind `impact.ts`: 13 weeks of daydream notes (both engines —
// the 12-week chart plus the current week; the window pair reaches 56 days), every commission, and the build ideas daydream proposed.
// A few hundred rows; the aggregation is in TypeScript so it is tested once.

import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamThoughts } from '$lib/db/schema';
import { DEFAULT_SUBJECT } from './types';
import { IMPACT_WEEKS, computeImpact, type Impact, type ImpactBuild, type ImpactCommission } from './impact';

export interface RecentResult {
  kind: 'check' | 'build';
  title: string;
  at: string;
  href: string;
}

export async function loadImpact(now = new Date()): Promise<{ impact: Impact; results: RecentResult[] }> {
  const since = new Date(now.getTime() - (IMPACT_WEEKS + 1) * 7 * 86_400_000);
  const [rows, commissions, builds] = await Promise.all([
    db
      .select({
        kind: daydreamThoughts.kind,
        status: daydreamThoughts.status,
        suppressedReason: daydreamThoughts.suppressedReason,
        feedback: daydreamThoughts.feedback,
        feedbackAt: daydreamThoughts.feedbackAt,
        createdAt: daydreamThoughts.createdAt,
        deliveredAt: daydreamThoughts.deliveredAt,
        evidence: daydreamThoughts.evidence,
      })
      .from(daydreamThoughts)
      .where(and(eq(daydreamThoughts.subject, DEFAULT_SUBJECT), gte(daydreamThoughts.createdAt, since))),
    db.execute(
      sql`SELECT id::text AS id, state, approved_at, created_at, updated_at, spec->>'title' AS title
        FROM daydream_commissions WHERE principal_id = 'owner' ORDER BY updated_at DESC LIMIT 500`,
    ),
    // Build ideas the loop proposed: backlog items it filed or cited itself on
    // (intake MERGES a restated idea as a citation, keeping the item's source), less
    // the backlog groups a fact check files for itself.
    db.execute(
      sql`SELECT r.key AS slug, r.data->>'title' AS title, r.data->>'status' AS status,
          r.data->'grooming'->>'acceptedAt' AS accepted_at, r.created_at, r.updated_at
        FROM datastore_records r
        JOIN datastore_collections col ON col.id = r.collection_id AND col.slug = 'improvement_backlog'
        WHERE r.data->>'commissionId' IS NULL
          AND (r.data->>'source' = 'think' OR (jsonb_typeof(r.data->'citations') = 'array' AND r.data->'citations' @> '[{"source":"think"}]'::jsonb))
        ORDER BY r.updated_at DESC LIMIT 500`,
    ),
  ]);

  const date = (v: unknown): Date | null => (v == null ? null : v instanceof Date ? v : new Date(String(v)));
  const cs: Array<ImpactCommission & { id: string; title: string }> = commissions.rows.map((r) => ({
    id: String(r.id),
    title: String(r.title ?? 'A fact check'),
    state: String(r.state),
    approvedAt: date(r.approved_at),
    createdAt: date(r.created_at)!,
    updatedAt: date(r.updated_at)!,
  }));
  const bs: Array<ImpactBuild & { slug: string; title: string }> = builds.rows.map((r) => ({
    slug: String(r.slug),
    title: String(r.title ?? 'A build idea'),
    status: String(r.status ?? 'open'),
    accepted: r.accepted_at != null,
    acceptedAt: date(r.accepted_at),
    createdAt: date(r.created_at)!,
    updatedAt: date(r.updated_at)!,
  }));

  const results: RecentResult[] = [
    ...cs
      .filter((c) => c.state === 'completed')
      .map((c) => ({ kind: 'check' as const, title: c.title, at: c.updatedAt.toISOString(), href: `/jkai/daydreams?commission=${encodeURIComponent(c.id)}` })),
    ...bs
      .filter((b) => b.status === 'shipped')
      .map((b) => ({ kind: 'build' as const, title: b.title, at: b.updatedAt.toISOString(), href: `/jkai/develop/backlog?item=${encodeURIComponent(b.slug)}` })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);

  return { impact: computeImpact(rows, cs, bs, now), results };
}
