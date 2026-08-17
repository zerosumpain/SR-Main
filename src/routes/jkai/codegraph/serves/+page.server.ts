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

  // Did serving actually change anything? Joined to jkai_iterations so the
  // answer comes from build records, not from the graph's own opinion of itself.
  const perBuild = await db.execute(sql`
    SELECT b.id,
           left(coalesce(b.title, b.prompt), 60)                    AS title,
           b.status,
           b.iterations_completed                                   AS iterations,
           count(q.id)::int                                         AS serves,
           count(*) FILTER (WHERE q.outcome = 'served')::int         AS served,
           count(*) FILTER (WHERE q.outcome = 'empty')::int          AS empty,
           count(*) FILTER (WHERE q.resolution = 'helpful')::int     AS helpful,
           count(*) FILTER (WHERE q.resolution = 'unhelpful')::int   AS unhelpful,
           b.created_at
    FROM jkai_builds b
    JOIN codegraph_queries q ON q.build_id = b.id
    GROUP BY b.id
    ORDER BY b.created_at DESC
    LIMIT 25
  `).then((r) => r.rows as Array<Record<string, unknown>>);

  // The headline comparison. Repo builds only — an app build has no history in
  // this graph, so including them would dilute the very thing being measured.
  const [impact] = await db.execute(sql`
    WITH served AS (SELECT DISTINCT build_id FROM codegraph_queries WHERE outcome = 'served')
    SELECT
      count(*) FILTER (WHERE s.build_id IS NULL)::int                              AS builds_without,
      round(avg(b.iterations_completed) FILTER (WHERE s.build_id IS NULL)::numeric, 2) AS mean_without,
      count(*) FILTER (WHERE s.build_id IS NOT NULL)::int                          AS builds_with,
      round(avg(b.iterations_completed) FILTER (WHERE s.build_id IS NOT NULL)::numeric, 2) AS mean_with
    FROM jkai_builds b
    LEFT JOIN served s ON s.build_id = b.id
    WHERE b.git_target_config IS NOT NULL AND b.git_target_config::text <> 'null'
  `).then((r) => r.rows as Array<Record<string, unknown>>);

  const [resolution] = await db.execute(sql`
    SELECT count(*) FILTER (WHERE resolution = 'helpful')::int   AS helpful,
           count(*) FILTER (WHERE resolution = 'unhelpful')::int AS unhelpful,
           count(*) FILTER (WHERE resolution IS NULL)::int       AS unresolved,
           -- Closed, deliberately uncounted: served on a file set, so no error
           -- existed for the outcome to be attributed to. Broken out rather
           -- than folded into the unresolved bucket, which would read as "we
           -- have not measured this yet" when the truth is "this can never be
           -- measured".
           count(*) FILTER (WHERE resolution = 'unattributable')::int AS unattributable
    FROM codegraph_queries WHERE channel = 'push'
  `).then((r) => r.rows as Array<Record<string, unknown>>);

  return { recent, byChannel, iterations, perBuild, impact: impact ?? {}, resolution: resolution ?? {} };
};
