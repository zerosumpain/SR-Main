// The honest usage record.
//
// This surface exists because of a specific, expensive precedent: the builder's
// site-tool bridge reported "Tool bridge OK — 167 site tools" on every one of
// 280 production iterations while never once being called, and the only thing
// that eventually proved it was SQL over recorded actions. So the question
// "is the codegraph actually being used, or is it decoration?" gets a page,
// and that page counts the EMPTY serves too — a system that shows only its
// hits cannot be told apart from one doing nothing.
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';

export const load: PageServerLoad = async () => {
  const recent = await db.execute(sql`
    SELECT channel, query, outcome, chars_served, duration_ms, build_id, error_message, created_at
    FROM codegraph_queries ORDER BY created_at DESC LIMIT 50
  `).then((r) => r.rows as Array<Record<string, unknown>>);

  const byChannel = await db.execute(sql`
    SELECT channel,
           count(*)::int AS total,
           count(*) FILTER (WHERE outcome = 'served')::int AS served,
           count(*) FILTER (WHERE outcome = 'empty')::int  AS empty,
           count(*) FILTER (WHERE outcome = 'failed')::int AS failed,
           round(avg(duration_ms))::int AS avg_ms
    FROM codegraph_queries
    WHERE created_at > now() - interval '30 days'
    GROUP BY channel ORDER BY total DESC
  `).then((r) => r.rows as Array<Record<string, unknown>>);

  // The measure the whole build is judged on. Frozen baseline recorded at ship
  // time (2026-08-17): 66 builds, 280 iterations, mean 4.24 iterations per
  // build. Anything after the first push-enabled build is the comparison.
  const iterations = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE b.created_at < timestamptz '2026-08-17')::int AS builds_before,
      round(avg(b.iterations_completed) FILTER (WHERE b.created_at < timestamptz '2026-08-17')::numeric, 2) AS mean_before,
      count(*) FILTER (WHERE b.created_at >= timestamptz '2026-08-17')::int AS builds_after,
      round(avg(b.iterations_completed) FILTER (WHERE b.created_at >= timestamptz '2026-08-17')::numeric, 2) AS mean_after
    FROM jkai_builds b
    WHERE b.git_target_config IS NOT NULL AND b.git_target_config::text <> 'null'
  `).then((r) => (r.rows as Array<Record<string, unknown>>)[0] ?? {});

  return { recent, byChannel, iterations };
};
