// src/lib/server/tool-error-rates.ts
//
// Per-tool error rates for /admin/ops/tool-usage, read from `jkai_tool_traces`.
//
// WHY A SECOND SOURCE. The rest of that page was once built on a SQLite
// session store, which cannot answer this question: tool results are stored
// tag-wrapped in `messages.content`, so there is no field to test for failure —
// which is why error rates were deliberately left off the page when it was built
// rather than shown misleadingly. The trace recorder does have the answer,
// because the chat route already classifies every step `done` or `error` as it
// happens, and that verdict is now stored per step.
//
// COVERAGE IS NOT THE SAME as the rest of the page, and the UI must say so:
//   - traces only exist from the day the recorder shipped, so a 90-day window
//     does not mean 90 days of evidence;
//   - traces cover jkai chat turns (general + canvas chat) — a tool invoked by a
//     workflow node run outside a chat turn never reaches this table.
// `coverageFrom` / `traceCount` are returned so the page can state both rather
// than implying a clean bill of health from an empty table.

import { db } from '$lib/db';
import { sql } from 'drizzle-orm';

export interface ToolErrorRow {
  tool: string;
  calls: number;
  errors: number;
  /** 0–1. */
  errorRate: number;
  /** Most recent failure message for this tool, for a one-glance diagnosis. */
  lastError: string | null;
  lastErrorAt: string | null;
}

export interface ToolErrorRates {
  days: number;
  totalCalls: number;
  totalErrors: number;
  /** 0–1 across every recorded call in the window. */
  errorRate: number;
  /** Turns recorded in the window — the denominator behind the coverage note. */
  traceCount: number;
  /** Oldest trace held at all (ignores the window), so the page can say when
   *  recording actually began instead of implying the window is fully covered. */
  coverageFrom: string | null;
  tools: ToolErrorRow[];
}

/** Longest error text carried to the UI; the trace page holds the full result. */
const ERROR_PREVIEW_CHARS = 240;

export async function getToolErrorRates(daysIn = 30): Promise<ToolErrorRates> {
  const days = Math.max(1, Math.min(365, Math.round(daysIn) || 30));

  // One pass over the window's steps. `displayTool` is already un-masked at
  // record time (jkai_extended unwrapped, mcp_ prefix stripped), so these names
  // line up with the page's resolved jkai sub-tool list rather than with the
  // raw `mcp_jkai_*` names the engine store reports.
  const perTool = await db.execute(sql`
    WITH steps AS (
      SELECT
        s ->> 'displayTool'                       AS tool,
        s ->> 'status'                            AS status,
        s ->> 'error'                             AS error,
        t.created_at                              AS at
      FROM jkai_tool_traces t,
           LATERAL jsonb_array_elements(t.steps -> 'steps') s
      WHERE t.created_at >= now() - (${days}::int * INTERVAL '1 day')
        AND s ->> 'displayTool' IS NOT NULL
    )
    SELECT
      tool,
      count(*)::int                                                   AS calls,
      count(*) FILTER (WHERE status = 'error')::int                   AS errors,
      (array_agg(error ORDER BY at DESC)
         FILTER (WHERE status = 'error' AND error IS NOT NULL))[1]    AS last_error,
      max(at) FILTER (WHERE status = 'error')                         AS last_error_at
    FROM steps
    GROUP BY tool
    ORDER BY errors DESC, calls DESC
    LIMIT 200
  `);

  const tools: ToolErrorRow[] = (perTool.rows as Array<Record<string, unknown>>).map((r) => {
    const calls = Number(r.calls ?? 0);
    const errors = Number(r.errors ?? 0);
    const lastError = typeof r.last_error === 'string' ? r.last_error.slice(0, ERROR_PREVIEW_CHARS) : null;
    return {
      tool: String(r.tool ?? '?'),
      calls,
      errors,
      errorRate: calls > 0 ? errors / calls : 0,
      lastError,
      lastErrorAt: r.last_error_at ? new Date(r.last_error_at as string).toISOString() : null,
    };
  });

  // Coverage is deliberately measured over ALL traces, not the window: the point
  // is to expose that recording may have started well inside it.
  const meta = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM jkai_tool_traces
        WHERE created_at >= now() - (${days}::int * INTERVAL '1 day'))  AS trace_count,
      (SELECT min(created_at) FROM jkai_tool_traces)                    AS coverage_from
  `);
  const metaRow = (meta.rows as Array<Record<string, unknown>>)[0] ?? {};

  const totalCalls = tools.reduce((n, t) => n + t.calls, 0);
  const totalErrors = tools.reduce((n, t) => n + t.errors, 0);

  return {
    days,
    totalCalls,
    totalErrors,
    errorRate: totalCalls > 0 ? totalErrors / totalCalls : 0,
    traceCount: Number(metaRow.trace_count ?? 0),
    coverageFrom: metaRow.coverage_from ? new Date(metaRow.coverage_from as string).toISOString() : null,
    tools,
  };
}
