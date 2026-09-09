import { maintenanceQueue } from '$lib/codegraph/maintenance.server';
import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async () => ({
  maintenance: await maintenanceQueue(),
  outcomes: (await db.execute(sql`WITH policies AS (
      SELECT build_id, CASE WHEN count(DISTINCT evidence->>'policyVersion') = 1 THEN max(evidence->>'policyVersion') ELSE 'mixed' END AS policy
      FROM codegraph_queries WHERE channel = 'push' GROUP BY build_id
    ) SELECT b.model_id, d.state->>'area' AS area, p.policy, b.budget_config,
      count(*)::int AS builds, count(*) FILTER (WHERE d.state->>'acceptedAt' IS NOT NULL)::int AS accepted,
      round(avg(b.cost_usd), 4) AS mean_cost, round(avg(b.tokens_used)) AS mean_tokens,
      round(avg(extract(epoch FROM ((d.state#>>'{cycle,firstPreviewAt}')::timestamptz - (d.state#>>'{cycle,startedAt}')::timestamptz)))) AS first_preview_seconds,
      round(avg(extract(epoch FROM ((d.state->>'acceptedAt')::timestamptz - (d.state#>>'{cycle,startedAt}')::timestamptz)))) AS accepted_seconds
      FROM jkai_build_deliveries d JOIN jkai_builds b ON b.id=d.build_id LEFT JOIN policies p ON p.build_id=b.id
      WHERE b.created_at > now() - interval '30 days'
      GROUP BY b.model_id, d.state->>'area', p.policy, b.budget_config`)).rows,
  cohorts: (await db.execute(sql`SELECT b.model_id, q.evidence->>'policyVersion' AS policy,
    count(DISTINCT b.id)::int AS builds, count(*)::int AS attempts,
    count(*) FILTER (WHERE q.outcome = 'failed')::int AS failed,
    count(*) FILTER (WHERE q.outcome = 'empty')::int AS empty,
    round(avg(q.duration_ms)) AS average_ms,
    round(avg(q.chars_served)) AS average_chars
    FROM codegraph_queries q LEFT JOIN jkai_builds b ON b.id = q.build_id
    WHERE q.created_at > now() - interval '30 days'
    GROUP BY b.model_id, q.evidence->>'policyVersion'`)).rows,
});
