/**
 * Reads what ./spend needs to build the owner's spend band.
 *
 * OWNER-ONLY, the same way ./sessions.server is: imported by the owner branch of
 * the /releases loader and nowhere else. Session titles, costs and the PRs
 * behind them never reach the public payload.
 *
 * Three narrow reads, none of which touches `full_transcript` or stage prose —
 * the band needs costs, PR numbers and file paths, and a session row with its
 * transcript is up to 1.5 MB.
 */
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { buildSpendBand, type SpendBand, type SpendReleaseRow, type SpendSessionRow } from './spend';

function rowsOf(result: unknown): Record<string, unknown>[] {
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

function iso(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function numbers(v: unknown): number[] {
  return Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
}

export async function getSpendBand(window: { from?: string; to?: string }): Promise<SpendBand> {
  const [sessionResult, stageResult, releaseResult] = await Promise.all([
    db.execute(sql`
      select id, title, project, started_at, est_cost_usd, cost_known, pull_requests,
             touched_paths, tokens, cost_breakdown, message_count, schema_version
      from claude_sessions
    `),
    db.execute(sql`
      select session_id, stage, sum(cost_usd)::float8 as cost
      from claude_session_stages
      group by 1, 2
    `),
    // Only releases some session links to: those are the only ones attribution
    // reads, and it keeps 1,100-odd file lists off the wire.
    db.execute(sql`
      with linked as (
        select distinct pr::int as n
        from claude_sessions, jsonb_array_elements_text(pull_requests) as pr
      )
      select r.id, r.deployed_at, coalesce(r.stats->'prs', '[]'::jsonb) as prs,
             coalesce((
               select jsonb_agg(jsonb_build_object(
                 'path', f->>'path',
                 'insertions', coalesce((f->>'insertions')::int, 0),
                 'deletions', coalesce((f->>'deletions')::int, 0)))
               from jsonb_array_elements(coalesce(r.files, '[]'::jsonb)) f
             ), '[]'::jsonb) as files,
             coalesce((
               select jsonb_agg(ri.title order by ri.ordinal)
               from release_items ri where ri.release_id = r.id
             ), '[]'::jsonb) as items
      from releases r
      where exists (
        select 1 from jsonb_array_elements_text(coalesce(r.stats->'prs', '[]'::jsonb)) p(n)
        join linked l on l.n = p.n::int
      )
    `),
  ]);

  const stagesBySession = new Map<string, { stage: string; costUsd: number }[]>();
  for (const r of rowsOf(stageResult)) {
    const id = String(r.session_id);
    (stagesBySession.get(id) ?? stagesBySession.set(id, []).get(id)!).push({
      stage: String(r.stage),
      costUsd: Number(r.cost ?? 0),
    });
  }

  const sessions: SpendSessionRow[] = rowsOf(sessionResult).map((r) => ({
    id: String(r.id),
    title: (r.title as string) ?? null,
    project: String(r.project ?? 'unknown'),
    startedAt: iso(r.started_at),
    costUsd: r.est_cost_usd == null ? 0 : Number(r.est_cost_usd),
    costKnown: r.cost_known !== false,
    prs: numbers(r.pull_requests),
    touched: Array.isArray(r.touched_paths) ? (r.touched_paths as { path: string; count: number }[]) : [],
    tokens: (r.tokens as SpendSessionRow['tokens']) ?? {},
    breakdown: Array.isArray(r.cost_breakdown) ? (r.cost_breakdown as SpendSessionRow['breakdown']) : [],
    stages: stagesBySession.get(String(r.id)) ?? [],
    messageCount: Number(r.message_count ?? 0),
    schemaVersion: Number(r.schema_version ?? 1),
  }));

  const releases: SpendReleaseRow[] = rowsOf(releaseResult).map((r) => ({
    id: Number(r.id),
    deployedAt: iso(r.deployed_at) ?? '',
    prs: numbers(r.prs),
    files: Array.isArray(r.files) ? (r.files as SpendReleaseRow['files']) : [],
    items: Array.isArray(r.items) ? (r.items as string[]).filter(Boolean) : [],
  }));

  return buildSpendBand(sessions, releases, window);
}
