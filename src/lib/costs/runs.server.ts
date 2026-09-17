/**
 * The LLM ledger, grouped by the thing that caused it.
 *
 * `/admin/ops/actions` rendered `select * from agent_actions limit 100` and
 * called it an Action Log. The problem was never granularity or the UI — the
 * TABLE CHANGED SPECIES underneath the page. Every one of its 33,667 rows is
 * `action_type = 'llm_call'`, written by a cost ledger, while the page renders
 * the columns an *agent action* would have had. Those columns are all null.
 *
 * The data to fix it was already there and thrown away. Measured on production:
 *
 *   9,679 rows carry a session_id that reaches a real object —
 *     5,145 a research session, 2,719 a workflow run, 476 a conversation,
 *     and 1,339 that resolve to none of the three (chat turns whose thread is in
 *     `input->>'conversationId'` instead).
 *   14,504 carry an `activity` tag and 3,326 an `origin` fingerprint.
 *   15,836 — 47% — carry neither.
 *
 * So this groups by the run, and then says plainly what could not be attributed
 * rather than padding the list with it. The untagged bucket is the LARGEST
 * single line of spend on the site (`gateway`: 23,983 calls, $12.54), and a page
 * that hides it behind 100 undifferentiated rows is why nobody could see that.
 *
 * No schema change. Every field used here already exists.
 */
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';

export type RunKind = 'research' | 'workflow' | 'chat' | 'unresolved';

export interface RunRow {
  id: string;
  kind: RunKind;
  /** The run's own name, when the object it points at has one. */
  label: string | null;
  /** Where to go to see the run itself. Null when the id resolves to nothing. */
  href: string | null;
  calls: number;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  models: string[];
  activities: string[];
  startedAt: Date | null;
  endedAt: Date | null;
}

/** Spend with no run attached, rolled up rather than listed. */
export interface UnattachedRow {
  source: string;
  /** The workload role, or the `fn@chunk:line` fingerprint, or neither. */
  attribution: string | null;
  calls: number;
  costUsd: number;
}

export interface RunLog {
  runs: RunRow[];
  unattached: UnattachedRow[];
  totals: {
    calls: number;
    costUsd: number;
    attributedCalls: number;
    /** Rows carrying neither an activity nor an origin. The honest number. */
    anonymousCalls: number;
    anonymousCostUsd: number;
  };
  hasMore: boolean;
}

/**
 * `db.execute()` returns the driver's QueryResult — `{ rows, rowCount, … }` —
 * NOT an array of rows. Casting it straight to a row array type compiles
 * perfectly and then throws `rows.map is not a function` at runtime, which is
 * how /releases went 500 for the owner on 2026-09-17.
 *
 * So the unwrap lives in one place and every reader goes through it. The house
 * pattern is `result.rows` (see $lib/jkai/grounding/quality.server.ts).
 */
function rowsOf(result: unknown): Record<string, unknown>[] {
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

const PAGE = 40;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export async function getRunLog(page = 0): Promise<RunLog> {
  const offset = Math.max(0, page) * PAGE;

  // One pass. The joins are LEFT so a session_id that resolves to nothing still
  // produces a row — an unresolved run is information, not a gap to drop.
  const runRows = await db.execute(sql`
    select
      a.session_id                                            as id,
      case
        when r.id is not null then 'research'
        when w.id is not null then 'workflow'
        when c.id is not null then 'chat'
        else 'unresolved'
      end                                                     as kind,
      coalesce(r.topic, w.workflow_id::text, c.title)         as label,
      count(*)::int                                           as calls,
      coalesce(sum(a.cost_usd), 0)                            as cost_usd,
      coalesce(sum(a.tokens_input), 0)::bigint                as tokens_in,
      coalesce(sum(a.tokens_output), 0)::bigint               as tokens_out,
      array_remove(array_agg(distinct a.model), null)         as models,
      array_remove(array_agg(distinct a.input->>'activity'), null) as activities,
      min(a.created_at)                                       as started_at,
      max(a.created_at)                                       as ended_at
    from agent_actions a
    left join research_session r    on r.id = a.session_id
    left join workflow_runs w       on w.id = a.session_id
    left join jkai_conversations c  on c.id = a.session_id
    where a.action_type = 'llm_call' and a.session_id is not null
    group by a.session_id, r.id, r.topic, w.id, w.workflow_id, c.id, c.title
    order by max(a.created_at) desc
    limit ${PAGE + 1} offset ${offset}
  `);

  const rows = rowsOf(runRows);
  const hasMore = rows.length > PAGE;
  const runs: RunRow[] = rows.slice(0, PAGE).map((r) => {
    const kind = String(r.kind) as RunKind;
    const id = String(r.id);
    return {
      id,
      kind,
      label: (r.label as string) ?? null,
      href:
        kind === 'research'
          ? `/research?session=${encodeURIComponent(id)}`
          : kind === 'workflow'
            ? `/jkai/canvas?run=${encodeURIComponent(id)}`
            : kind === 'chat'
              ? `/jkai?thread=${encodeURIComponent(id)}`
              : null,
      calls: num(r.calls),
      costUsd: num(r.cost_usd),
      tokensIn: num(r.tokens_in),
      tokensOut: num(r.tokens_out),
      models: (r.models as string[]) ?? [],
      activities: (r.activities as string[]) ?? [],
      startedAt: r.started_at ? new Date(r.started_at as string) : null,
      endedAt: r.ended_at ? new Date(r.ended_at as string) : null,
    };
  });

  // Everything with no run to hang on, rolled up by where it came from. The
  // point is that this is a SHORT list — five sources — rather than 24,000 rows.
  const unRows = rowsOf(await db.execute(sql`
    select
      coalesce(a.input->>'source', 'untagged')                      as source,
      coalesce(a.input->>'activity', a.input->>'origin')            as attribution,
      count(*)::int                                                 as calls,
      coalesce(sum(a.cost_usd), 0)                                  as cost_usd
    from agent_actions a
    where a.action_type = 'llm_call' and a.session_id is null
    group by 1, 2
    order by 4 desc, 3 desc
    limit 40
  `));

  const unattached: UnattachedRow[] = unRows.map((r) => ({
    source: String(r.source),
    attribution: (r.attribution as string) ?? null,
    calls: num(r.calls),
    costUsd: num(r.cost_usd),
  }));

  const [t] = rowsOf(await db.execute(sql`
    select
      count(*)::int                                                          as calls,
      coalesce(sum(cost_usd), 0)                                             as cost_usd,
      count(*) filter (
        where jsonb_exists(input, 'activity') or jsonb_exists(input, 'origin'))::int  as attributed,
      count(*) filter (
        where not jsonb_exists(input, 'activity')
          and not jsonb_exists(input, 'origin'))::int                                 as anonymous,
      coalesce(sum(cost_usd) filter (
        where not jsonb_exists(input, 'activity')
          and not jsonb_exists(input, 'origin')), 0)                                  as anonymous_cost
    from agent_actions
    where action_type = 'llm_call'
  `));

  return {
    runs,
    unattached,
    totals: {
      calls: num(t?.calls),
      costUsd: num(t?.cost_usd),
      attributedCalls: num(t?.attributed),
      anonymousCalls: num(t?.anonymous),
      anonymousCostUsd: num(t?.anonymous_cost),
    },
    hasMore,
  };
}
