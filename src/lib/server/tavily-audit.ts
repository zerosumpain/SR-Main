/**
 * What has been spending Tavily credits, read back out of the ledger that
 * `$lib/deepdive/tavily-ledger` writes (`agent_actions`, `action_type =
 * 'tavily_call'`). Feeds /admin/ops/tavily.
 *
 * Credits are summed from `input ->> 'credits'`, the published credit model
 * applied at call time, so they are an estimate of what Tavily billed rather
 * than a receipt. The page sets them beside the account's own `plan_usage`,
 * and the difference between the two is the point: it is the spend made by
 * anything that holds the key but does not write this ledger.
 */
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';

const WINDOWS = [1, 7, 30, 90] as const;
export type TavilyWindow = (typeof WINDOWS)[number];

export function clampTavilyDays(raw: string | null): TavilyWindow {
  const n = Number(raw);
  return (WINDOWS as readonly number[]).includes(n) ? (n as TavilyWindow) : 30;
}

/** Newest requests listed; more when the list is narrowed to one process. */
const RECENT_LIMIT = 60;
const RECENT_LIMIT_FILTERED = 200;

export interface TavilyPurposeRow {
  app: string;
  purpose: string;
  calls: number;
  searches: number;
  extracts: number;
  credits: number;
  failed: number;
  lastAt: string | null;
}

export interface TavilyTriggerRow {
  kind: 'research' | 'workflow' | 'chat' | 'activity' | 'none';
  id: string | null;
  label: string;
  href: string | null;
  calls: number;
  credits: number;
  lastAt: string | null;
}

export interface TavilyRepeatRow {
  query: string;
  calls: number;
  credits: number;
  purposes: string[];
  firstAt: string | null;
  lastAt: string | null;
}

export interface TavilyCallRow {
  id: string;
  at: string;
  app: string;
  purpose: string;
  kind: string;
  depth: string | null;
  query: string | null;
  urls: string[];
  urlCount: number;
  credits: number;
  ok: boolean;
  error: string | null;
  durationMs: number | null;
  resultCount: number | null;
  attempt: number;
  trigger: { kind: TavilyTriggerRow['kind']; label: string; href: string | null };
}

export interface TavilyAudit {
  days: TavilyWindow;
  totals: { calls: number; credits: number; failed: number; searches: number; extracts: number };
  /** Ledger credits since the start of the calendar month (UTC), for the account comparison. */
  monthCredits: number;
  /** When the ledger's oldest row was written — the page cannot speak for anything before it. */
  recordingSince: string | null;
  byPurpose: TavilyPurposeRow[];
  byTrigger: TavilyTriggerRow[];
  repeats: TavilyRepeatRow[];
  perDay: { day: string; credits: number; calls: number; top: string | null }[];
  recent: TavilyCallRow[];
}

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());
const rowsOf = <T>(result: unknown): T[] =>
  ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];

/** The trigger a row belongs to, most specific first. */
const TRIGGER_KIND = sql.raw(`case
  when a.input ? 'researchSessionId' then 'research'
  when a.input ? 'workflowId' then 'workflow'
  when a.input ? 'conversationId' or a.input ? 'jobId' then 'chat'
  when a.input ? 'activity' then 'activity'
  else 'none' end`);
const TRIGGER_ID = sql.raw(`coalesce(a.input ->> 'researchSessionId', a.input ->> 'workflowId',
  a.input ->> 'conversationId', a.input ->> 'jobId', a.input ->> 'activity')`);

function triggerLabel(kind: TavilyTriggerRow['kind'], id: string | null, name: string | null) {
  switch (kind) {
    case 'research':
      return { label: name ? `Research: ${name}` : `Research ${id?.slice(0, 8)}`, href: id ? `/research/${id}` : null };
    case 'workflow': {
      const slug = name?.startsWith('canvas:') ? name.slice('canvas:'.length) : null;
      return { label: `Workflow: ${slug ?? name ?? id?.slice(0, 8)}`, href: slug ? `/jkai/canvas/${slug}` : null };
    }
    case 'chat':
      return { label: `Chat ${id?.slice(0, 8)}`, href: null };
    case 'activity':
      return { label: `Activity: ${id}`, href: null };
    default:
      return { label: 'No surrounding context', href: null };
  }
}

export async function getTavilyAudit(days: TavilyWindow, purpose: string | null = null): Promise<TavilyAudit> {
  const since = new Date(Date.now() - days * 86_400_000);
  const scope = sql`a.action_type = 'tavily_call' and a.created_at >= ${since}`;
  const recentScope = purpose ? sql`${scope} and a.input ->> 'purpose' = ${purpose}` : scope;
  const credits = sql.raw(`coalesce(sum((a.input ->> 'credits')::numeric), 0)`);

  const [totalsRes, monthRes, sinceRes, purposeRes, triggerRes, repeatRes, dayRes, recentRes] = await Promise.all([
    db.execute(sql`
      select count(*)::int as calls, ${credits} as credits,
        count(*) filter (where a.status = 'failed')::int as failed,
        count(*) filter (where a.tool_name = 'search')::int as searches,
        count(*) filter (where a.tool_name = 'extract')::int as extracts
      from agent_actions a where ${scope}`),
    db.execute(sql`
      select ${credits} as credits from agent_actions a
      where a.action_type = 'tavily_call' and a.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'`),
    db.execute(sql`select min(a.created_at) as first_at from agent_actions a where a.action_type = 'tavily_call'`),
    db.execute(sql`
      select coalesce(a.input ->> 'app', '?') as app, coalesce(a.input ->> 'purpose', 'unlabelled') as purpose,
        count(*)::int as calls,
        count(*) filter (where a.tool_name = 'search')::int as searches,
        count(*) filter (where a.tool_name = 'extract')::int as extracts,
        ${credits} as credits,
        count(*) filter (where a.status = 'failed')::int as failed,
        max(a.created_at) as last_at
      from agent_actions a where ${scope}
      group by 1, 2 order by credits desc, calls desc`),
    db.execute(sql`
      select t.kind, t.id, count(*)::int as calls, coalesce(sum(t.credits), 0) as credits, max(t.created_at) as last_at,
        max(rs.topic) as research_topic, max(w.name) as workflow_name
      from (
        select ${TRIGGER_KIND} as kind, ${TRIGGER_ID} as id,
          (a.input ->> 'credits')::numeric as credits, a.created_at
        from agent_actions a where ${scope}
      ) t
      left join research_session rs on t.kind = 'research' and rs.id = t.id
      left join workflows w on t.kind = 'workflow' and w.id = t.id
      group by t.kind, t.id order by credits desc, calls desc limit 25`),
    db.execute(sql`
      select lower(trim(a.input ->> 'query')) as query, count(*)::int as calls, ${credits} as credits,
        array_agg(distinct coalesce(a.input ->> 'purpose', 'unlabelled')) as purposes,
        min(a.created_at) as first_at, max(a.created_at) as last_at
      from agent_actions a where ${scope} and a.input ? 'query' and a.status = 'completed'
      group by 1 having count(*) > 1 order by calls desc, credits desc limit 15`),
    db.execute(sql`
      select g.day, sum(g.calls)::int as calls, sum(g.credits) as credits,
        (array_agg(g.purpose order by g.credits desc))[1] as top
      from (
        select to_char(a.created_at at time zone 'utc', 'YYYY-MM-DD') as day,
          coalesce(a.input ->> 'purpose', 'unlabelled') as purpose,
          count(*)::int as calls, ${credits} as credits
        from agent_actions a where ${scope} group by 1, 2
      ) g group by g.day order by g.day`),
    db.execute(sql`
      select a.id, a.created_at, a.tool_name, a.status, a.error, a.duration_ms, a.input,
        ${TRIGGER_KIND} as trigger_kind, ${TRIGGER_ID} as trigger_id,
        rs.topic as research_topic, w.name as workflow_name
      from agent_actions a
      left join research_session rs on a.input ->> 'researchSessionId' = rs.id
      left join workflows w on a.input ->> 'workflowId' = w.id
      where ${recentScope}
      order by a.created_at desc limit ${purpose ? RECENT_LIMIT_FILTERED : RECENT_LIMIT}`),
  ]);

  const totals = rowsOf<Record<string, unknown>>(totalsRes)[0] ?? {};

  const byTrigger = rowsOf<Record<string, unknown>>(triggerRes).map((r) => {
    const kind = r.kind as TavilyTriggerRow['kind'];
    const id = (r.id as string | null) ?? null;
    const name = (kind === 'research' ? r.research_topic : r.workflow_name) as string | null;
    return { kind, id, ...triggerLabel(kind, id, name), calls: n(r.calls), credits: n(r.credits), lastAt: iso(r.last_at) };
  });

  const recent = rowsOf<Record<string, unknown>>(recentRes).map((r): TavilyCallRow => {
    const input = (r.input ?? {}) as Record<string, unknown>;
    const kind = r.trigger_kind as TavilyTriggerRow['kind'];
    const id = (r.trigger_id as string | null) ?? null;
    const name = (kind === 'research' ? r.research_topic : r.workflow_name) as string | null;
    return {
      id: String(r.id),
      at: iso(r.created_at) ?? '',
      app: String(input.app ?? '?'),
      purpose: String(input.purpose ?? 'unlabelled'),
      kind: String(r.tool_name ?? ''),
      depth: typeof input.depth === 'string' ? input.depth : null,
      query: typeof input.query === 'string' ? input.query : null,
      urls: Array.isArray(input.urls) ? input.urls.map(String) : [],
      urlCount: n(input.urlCount),
      credits: n(input.credits),
      ok: r.status !== 'failed',
      error: (r.error as string | null) ?? null,
      durationMs: r.duration_ms == null ? null : n(r.duration_ms),
      resultCount: typeof input.resultCount === 'number' ? input.resultCount : null,
      attempt: n(input.attempt) || 1,
      trigger: { kind, ...triggerLabel(kind, id, name) },
    };
  });

  return {
    days,
    totals: {
      calls: n(totals.calls),
      credits: n(totals.credits),
      failed: n(totals.failed),
      searches: n(totals.searches),
      extracts: n(totals.extracts),
    },
    monthCredits: n(rowsOf<Record<string, unknown>>(monthRes)[0]?.credits),
    recordingSince: iso(rowsOf<Record<string, unknown>>(sinceRes)[0]?.first_at),
    byPurpose: rowsOf<Record<string, unknown>>(purposeRes).map((r) => ({
      app: String(r.app),
      purpose: String(r.purpose),
      calls: n(r.calls),
      searches: n(r.searches),
      extracts: n(r.extracts),
      credits: n(r.credits),
      failed: n(r.failed),
      lastAt: iso(r.last_at),
    })),
    byTrigger,
    repeats: rowsOf<Record<string, unknown>>(repeatRes).map((r) => ({
      query: String(r.query ?? ''),
      calls: n(r.calls),
      credits: n(r.credits),
      purposes: Array.isArray(r.purposes) ? r.purposes.map(String) : [],
      firstAt: iso(r.first_at),
      lastAt: iso(r.last_at),
    })),
    perDay: rowsOf<Record<string, unknown>>(dayRes).map((r) => ({
      day: String(r.day),
      calls: n(r.calls),
      credits: n(r.credits),
      top: (r.top as string | null) ?? null,
    })),
    recent,
  };
}
