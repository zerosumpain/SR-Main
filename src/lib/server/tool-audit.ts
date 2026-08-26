// Which tools actually get called, read from `jkai_tool_traces`.
//
// WHY THIS MOVED. This used to query the Hermes SQLite session store over
// Tailscale. That store froze when Hermes stopped on 2026-08-24 and went on
// answering every query with rows from before it died, so the page looked
// healthy while reporting a dead month. The trace table is in this app's own
// Postgres and is written by the chat route as the turn happens.
//
// COVERAGE, STATED NOT IMPLIED. Traces exist only from the day the recorder
// shipped, and only for jkai chat turns — a tool invoked by a workflow node
// outside a chat turn never reaches this table. `coverageFrom` is returned
// unwindowed so the page can say when recording began rather than implying the
// whole window is covered, and `storeNewestAt` is likewise unwindowed: a
// windowed max cannot tell you the store is dead, because inside a dead window
// it returns nothing and inside a live one it just repeats the window.

import { db } from '$lib/db';
import { sql } from 'drizzle-orm';

export interface ToolAuditCount {
  tool: string;
  calls: number;
  errors: number;
}
export interface ToolAuditDay {
  day: string;
  calls: number;
}
export interface ToolAuditHour {
  hour: number;
  calls: number;
}

export interface ToolAudit {
  days: number;
  /** Newest trace held at all, ignoring the window. Null = cannot vouch for
   *  freshness, which a caller must treat as stale. */
  storeNewestAt: string | null;
  /** Oldest trace held at all, so the caller can say when recording began. */
  coverageFrom: string | null;
  /** Turns recorded in the window — the denominator behind the coverage note. */
  traceCount: number;
  totalCalls: number;
  uniqueTools: number;
  /** Full ranking by call count. Names are already un-masked at record time. */
  tools: ToolAuditCount[];
  /** Total tool calls per day (trend). */
  perDay: ToolAuditDay[];
  /** Hour-of-day distribution (0–23), in the database's timezone. */
  byHour: ToolAuditHour[];
}

function clamp(daysIn: number): number {
  return Math.max(1, Math.min(365, Math.round(daysIn) || 30));
}

export async function getToolAudit(daysIn = 30): Promise<ToolAudit> {
  const days = clamp(daysIn);

  const perTool = await db.execute(sql`
    WITH steps AS (
      SELECT
        s ->> 'displayTool' AS tool,
        s ->> 'status'      AS status,
        t.created_at        AS at
      FROM jkai_tool_traces t,
           LATERAL jsonb_array_elements(t.steps -> 'steps') s
      WHERE t.created_at >= now() - (${days}::int * INTERVAL '1 day')
        AND s ->> 'displayTool' IS NOT NULL
    )
    SELECT
      tool,
      count(*)::int                                 AS calls,
      count(*) FILTER (WHERE status = 'error')::int AS errors
    FROM steps
    GROUP BY tool
    ORDER BY calls DESC
    LIMIT 500
  `);

  const tools: ToolAuditCount[] = (perTool.rows as Array<Record<string, unknown>>).map((r) => ({
    tool: String(r.tool ?? '?'),
    calls: Number(r.calls ?? 0),
    errors: Number(r.errors ?? 0),
  }));

  const trend = await db.execute(sql`
    WITH steps AS (
      SELECT t.created_at AS at
      FROM jkai_tool_traces t,
           LATERAL jsonb_array_elements(t.steps -> 'steps') s
      WHERE t.created_at >= now() - (${days}::int * INTERVAL '1 day')
        AND s ->> 'displayTool' IS NOT NULL
    )
    SELECT to_char(date_trunc('day', at), 'YYYY-MM-DD') AS day, count(*)::int AS calls
    FROM steps GROUP BY 1 ORDER BY 1
  `);

  const hours = await db.execute(sql`
    WITH steps AS (
      SELECT t.created_at AS at
      FROM jkai_tool_traces t,
           LATERAL jsonb_array_elements(t.steps -> 'steps') s
      WHERE t.created_at >= now() - (${days}::int * INTERVAL '1 day')
        AND s ->> 'displayTool' IS NOT NULL
    )
    SELECT extract(hour FROM at)::int AS hour, count(*)::int AS calls
    FROM steps GROUP BY 1 ORDER BY 1
  `);

  const meta = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM jkai_tool_traces
        WHERE created_at >= now() - (${days}::int * INTERVAL '1 day')) AS trace_count,
      (SELECT max(created_at) FROM jkai_tool_traces)                   AS newest,
      (SELECT min(created_at) FROM jkai_tool_traces)                   AS oldest
  `);
  const m = (meta.rows as Array<Record<string, unknown>>)[0] ?? {};

  return {
    days,
    storeNewestAt: m.newest ? new Date(m.newest as string).toISOString() : null,
    coverageFrom: m.oldest ? new Date(m.oldest as string).toISOString() : null,
    traceCount: Number(m.trace_count ?? 0),
    totalCalls: tools.reduce((n, t) => n + t.calls, 0),
    uniqueTools: tools.length,
    tools,
    perDay: (trend.rows as Array<Record<string, unknown>>).map((r) => ({
      day: String(r.day),
      calls: Number(r.calls ?? 0),
    })),
    byHour: (hours.rows as Array<Record<string, unknown>>).map((r) => ({
      hour: Number(r.hour ?? 0),
      calls: Number(r.calls ?? 0),
    })),
  };
}
